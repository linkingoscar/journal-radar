"""Personal journal registry and editable groups; public RSS requests are IP pinned."""

from __future__ import annotations
import copy
import hashlib
import ipaddress
import json
import re
import socket
from types import SimpleNamespace
from urllib.parse import urlsplit, urljoin, urlunsplit
import feedparser
import requests
import urllib3
from run import get, plain

SYSTEM_GROUPS = {"hr35", "ft50", "utd24", "custom", "all"}


def issn(value):
    value = str(value).strip().upper().replace("-", "")
    if not re.fullmatch(r"\d{7}[\dX]", value):
        raise ValueError("请输入有效的 ISSN，例如 0093-5301")
    digits = [int(c) if c != "X" else 10 for c in value]
    if sum(n * weight for n, weight in zip(digits, range(8, 0, -1))) % 11:
        raise ValueError("ISSN 校验位不正确，请核对后重试")
    return value[:4] + "-" + value[4:]


def public_target(url):
    try:
        parsed = urlsplit(url)
        if (
            parsed.scheme not in ("https", "http")
            or not parsed.hostname
            or parsed.username
            or parsed.password
            or parsed.fragment
        ):
            raise ValueError()
        port = parsed.port or (443 if parsed.scheme == "https" else 80)
        if port not in (80, 443):
            raise ValueError()
        addresses = {
            item[4][0]
            for item in socket.getaddrinfo(
                parsed.hostname, port, type=socket.SOCK_STREAM
            )
        }
        # Some desktop proxies return synthetic addresses from the benchmark range.
        # Resolve these names through public DoH; never connect to the synthetic IP.
        synthetic = ipaddress.ip_network("198.18.0.0/15")
        if addresses and all(ipaddress.ip_address(a) in synthetic for a in addresses):
            response = requests.get(
                "https://dns.google/resolve",
                params={
                    "name": parsed.hostname.encode("idna").decode(),
                    "type": "A",
                    "edns_client_subnet": "0.0.0.0/0",
                },
                timeout=(5, 10),
            )
            response.raise_for_status()
            answer = response.json()
            if answer.get("Status") != 0:
                raise ValueError()
            addresses = {
                r["data"] for r in answer.get("Answer", []) if r.get("type") == 1
            }
        if not addresses or any(
            not ipaddress.ip_address(a).is_global for a in addresses
        ):
            raise ValueError()
        return parsed, port, sorted(addresses)[0]
    except (ValueError, OSError, requests.RequestException):
        raise ValueError("RSS 必须是公网 HTTP/HTTPS 地址，不能访问本机或内网") from None


def public_feed_get(url):
    for _ in range(6):
        parsed, port, address = public_target(url)
        # Connect to the validated IP, preserving the TLS hostname. DNS cannot change
        # between validation and connection; each redirect is validated again.
        cls = (
            urllib3.HTTPSConnectionPool
            if parsed.scheme == "https"
            else urllib3.HTTPConnectionPool
        )
        tls = (
            {"server_hostname": parsed.hostname, "assert_hostname": parsed.hostname}
            if parsed.scheme == "https"
            else {}
        )
        with cls(address, port=port, **tls) as pool:
            response = pool.urlopen(
                "GET",
                urlunsplit(("", "", parsed.path or "/", parsed.query, "")),
                headers={
                    "Host": parsed.netloc,
                    "User-Agent": "JournalRadar/1.0",
                    "Accept-Encoding": "identity",
                },
                redirect=False,
                retries=False,
                preload_content=False,
                timeout=urllib3.Timeout(connect=10, read=20),
            )
            try:
                if response.status in (301, 302, 303, 307, 308):
                    url = urljoin(url, response.headers.get("Location", ""))
                    continue
                if response.status != 200:
                    raise ValueError(f"RSS 来源返回 HTTP {response.status}")
                content = response.read(5_000_001)
                if len(content) > 5_000_000:
                    raise ValueError("RSS 超过 5 MB，请使用期刊专属订阅地址")
                return SimpleNamespace(content=content)
            finally:
                response.close()
    raise ValueError("RSS 重定向次数过多")


def journal_from_crossref(item):
    identifiers = list(dict.fromkeys(issn(i) for i in item.get("ISSN", [])))
    name = plain(item.get("title"))
    if not identifiers or not name:
        raise ValueError("来源没有提供完整期刊名称和 ISSN")
    return {
        "id": identifiers[0],
        "name": name,
        "short_name": name,
        "issns": identifiers,
        "groups": [],
        "enabled": True,
        "rss_url": None,
        "crossref_identity_verified": True,
        "crossref_title": name,
        "publisher": plain(item.get("publisher")),
        "sources": ["https://api.crossref.org/journals/" + identifiers[0]],
    }


def same_journal(a, b):
    return (
        a["id"] == b["id"]
        or bool(set(a.get("issns", [])) & set(b.get("issns", [])))
        or bool(a.get("rss_url") and a["rss_url"] == b.get("rss_url"))
    )


def lookup(query, registry, rss_url="", getter=get, feed_getter=public_feed_get):
    if (
        not isinstance(query, str)
        or not isinstance(rss_url, str)
        or len(query) > 2000
        or len(rss_url) > 2000
    ):
        raise ValueError("查询内容过长或格式错误")
    query, rss_url = query.strip(), rss_url.strip()
    feed = None
    if query.startswith(("https://", "http://")):
        rss_url, query = query, ""
    if rss_url:
        feed = feedparser.parse(feed_getter(rss_url).content)
        if not feed.version or not feed.feed.get("title"):
            raise ValueError("该地址不是带有期刊名称的 RSS/Atom 订阅")
        if feed.bozo and not isinstance(
            feed.bozo_exception, feedparser.CharacterEncodingOverride
        ):
            raise ValueError("RSS 内容不完整，请检查订阅地址")
        query = query or plain(feed.feed.title)
    if not query:
        raise ValueError("请输入期刊名称、ISSN 或 RSS 地址")
    compact = query.upper().replace("-", "").replace(" ", "")
    identifier = issn(compact) if re.fullmatch(r"\d{7}[\dX]", compact) else None
    existing = [
        j
        for j in registry["journals"]
        if (identifier and identifier in j["issns"])
        or j["name"].casefold() == query.casefold()
        or (rss_url and j.get("rss_url") == rss_url)
    ]
    if existing:
        candidates = copy.deepcopy(existing)
    else:
        try:
            payload = getter(
                "https://api.crossref.org/journals"
                + ("/" + identifier if identifier else ""),
                **(
                    {}
                    if identifier
                    else {"params": {"query": query.replace("&", "and"), "rows": 12}}
                ),
            ).json()["message"]
            candidates = []
            for item in [payload] if identifier else payload["items"]:
                try:
                    journal = journal_from_crossref(item)
                except ValueError:
                    continue
                if not any(same_journal(journal, j) for j in candidates):
                    candidates.append(journal)
            candidates.sort(key=lambda j: j["name"].casefold() != query.casefold())
        except Exception:
            if not feed:
                raise
            candidates = []
    if feed:
        for journal in candidates:
            journal["rss_url"] = rss_url
        if not existing:
            candidates.append(
                {
                    "id": "rss-" + hashlib.sha256(rss_url.encode()).hexdigest()[:16],
                    "name": plain(feed.feed.title),
                    "short_name": plain(feed.feed.title),
                    "issns": [],
                    "groups": [],
                    "enabled": True,
                    "rss_url": rss_url,
                    "crossref_enabled": False,
                    "sources": [rss_url],
                }
            )
    return candidates


def validate_groups(groups, journal_ids):
    if not isinstance(groups, list) or len(groups) > 100:
        raise ValueError("最多创建 100 个个人分组")
    result, ids, names = [], set(), set()
    for group in groups:
        if not isinstance(group, dict):
            raise ValueError("分组格式错误")
        identifier, name, members = (
            group.get("id"),
            group.get("name"),
            group.get("journal_ids"),
        )
        if (
            not isinstance(identifier, str)
            or not re.fullmatch(r"[a-z][a-z0-9_-]{0,63}", identifier)
            or identifier in SYSTEM_GROUPS
            or identifier in ids
        ):
            raise ValueError("分组标识无效或重复")
        if (
            not isinstance(name, str)
            or not name.strip()
            or len(name.strip()) > 40
            or name.strip().casefold() in names
        ):
            raise ValueError("分组名称不能为空、重复或超过 40 字")
        if not isinstance(members, list) or any(
            not isinstance(i, str) or i not in journal_ids for i in members
        ):
            raise ValueError("分组包含尚未添加的期刊")
        ids.add(identifier)
        names.add(name.strip().casefold())
        result.append(
            {
                "id": identifier,
                "name": name.strip(),
                "journal_ids": list(dict.fromkeys(members)),
            }
        )
    return result


def portable_journal(value):
    if not isinstance(value, dict):
        raise ValueError("备份期刊格式错误")
    identifier, name = value.get("id"), value.get("name")
    if not isinstance(name, str) or not name.strip() or len(name) > 500:
        raise ValueError("备份期刊名称无效")
    identifiers = value.get("issns", [])
    if not isinstance(identifiers, list) or len(identifiers) > 20:
        raise ValueError("备份 ISSN 无效")
    identifiers = list(dict.fromkeys(issn(i) for i in identifiers))
    rss = value.get("rss_url") or None
    if rss:
        if not isinstance(rss, str) or len(rss) > 2000:
            raise ValueError("RSS 地址无效")
        parsed = urlsplit(rss)
        if (
            parsed.scheme not in ("http", "https")
            or not parsed.hostname
            or parsed.username
            or parsed.password
            or parsed.fragment
        ):
            raise ValueError("RSS 必须是公网 HTTP/HTTPS 地址")
        if parsed.hostname.lower() in (
            "localhost",
            "localhost.localdomain",
        ) or parsed.hostname.lower().endswith((".localhost", ".local")):
            raise ValueError("RSS 不允许本机地址")
        try:
            address = ipaddress.ip_address(parsed.hostname)
        except ValueError:
            address = None
        if address and not address.is_global:
            raise ValueError("RSS 不允许内网地址")
    if isinstance(identifier, str) and identifier.startswith("rss-"):
        if (
            not rss
            or identifier != "rss-" + hashlib.sha256(rss.encode()).hexdigest()[:16]
        ):
            raise ValueError("RSS 期刊标识与地址不匹配")
    elif (
        not isinstance(identifier, str)
        or issn(identifier) != identifier
        or identifier not in identifiers
    ):
        raise ValueError("备份期刊标识与 ISSN 不匹配")
    result = {
        "id": identifier,
        "name": name.strip(),
        "short_name": name.strip(),
        "issns": identifiers,
        "groups": [],
        "rss_url": rss,
        "enabled": True,
        "crossref_enabled": not identifier.startswith("rss-")
        and value.get("crossref_enabled", True) is not False,
        "user_added": True,
        "sources": [rss] if rss else [],
    }
    return result


class Library:
    def __init__(self, base, path):
        self.base, self.path = copy.deepcopy(base), path
        self.local = {"journals": [], "groups": {}, "deleted_groups": []}
        if path.exists():
            self.local = json.loads(path.read_text(encoding="utf-8"))

    def registry(self):
        registry = copy.deepcopy(self.base)
        for journal in self.local["journals"]:
            if not any(same_journal(journal, j) for j in registry["journals"]):
                registry["journals"].append(copy.deepcopy(journal))
        groups = {g["id"]: g for g in registry.get("groups", [])}
        groups.update(copy.deepcopy(self.local["groups"]))
        registry["groups"] = [
            g for key, g in groups.items() if key not in self.local["deleted_groups"]
        ]
        dynamic = set(groups) | set(self.local["deleted_groups"])
        for journal in registry["journals"]:
            journal["groups"] = [g for g in journal["groups"] if g not in dynamic]
            journal["groups"] += [
                g["id"] for g in registry["groups"] if journal["id"] in g["journal_ids"]
            ]
        return registry

    def save(self, local):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temp = self.path.with_suffix(".json.tmp")
        temp.write_text(
            json.dumps(local, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        temp.replace(self.path)
        self.local = local

    def save_groups(self, groups):
        registry = self.registry()
        clean = validate_groups(groups, {j["id"] for j in registry["journals"]})
        local = copy.deepcopy(self.local)
        local["groups"] = {g["id"]: g for g in clean}
        local["deleted_groups"] = [
            g["id"]
            for g in self.base.get("groups", [])
            if g["id"] not in local["groups"]
        ]
        self.save(local)

    def merge_backup(self, value):
        if not isinstance(value, dict) or value.get("version") != 1:
            raise ValueError("期刊配置备份版本不支持")
        journals = value.get("journals")
        if not isinstance(journals, list) or len(journals) > 2000:
            raise ValueError("期刊配置备份数量无效")
        incoming = [portable_journal(j) for j in journals]
        if len({j["id"] for j in incoming}) != len(incoming):
            raise ValueError("备份期刊标识重复")
        groups = validate_groups(value.get("groups"), {j["id"] for j in incoming})
        deleted = value.get("deleted", [])
        if (
            not isinstance(deleted, list)
            or len(deleted) > 100
            or any(
                not isinstance(i, str)
                or not re.fullmatch(r"[a-z][a-z0-9_-]{0,63}", i)
                or i in SYSTEM_GROUPS
                for i in deleted
            )
        ):
            raise ValueError("已删除分组记录无效")
        registry, local, aliases = self.registry(), copy.deepcopy(self.local), {}
        for journal in incoming:
            existing = next(
                (j for j in registry["journals"] if same_journal(journal, j)), None
            )
            if existing:
                aliases[journal["id"]] = existing["id"]
            else:
                local["journals"].append(journal)
                registry["journals"].append(journal)
        merged = {g["id"]: copy.deepcopy(g) for g in registry.get("groups", [])}
        for group in groups:
            members = [aliases.get(i, i) for i in group["journal_ids"]]
            existing = merged.get(group["id"]) or next(
                (
                    g
                    for g in merged.values()
                    if g["name"].casefold() == group["name"].casefold()
                ),
                None,
            )
            if existing:
                existing["journal_ids"] = list(
                    dict.fromkeys(existing["journal_ids"] + members)
                )
            else:
                merged[group["id"]] = {
                    **group,
                    "journal_ids": list(dict.fromkeys(members)),
                }
        # Honor source deletions only for untouched seed groups on the destination.
        for group in self.base.get("groups", []):
            if (
                group["id"] in deleted
                and group["id"] not in self.local["groups"]
                and not any(g["id"] == group["id"] for g in groups)
            ):
                merged.pop(group["id"], None)
        clean = validate_groups(
            list(merged.values()), {j["id"] for j in registry["journals"]}
        )
        local["groups"] = {g["id"]: g for g in clean}
        local["deleted_groups"] = [
            g["id"]
            for g in self.base.get("groups", [])
            if g["id"] not in local["groups"]
        ]
        self.save(local)
        return aliases

    def add(self, candidate, group_id=""):
        registry = self.registry()
        if group_id and group_id not in {g["id"] for g in registry["groups"]}:
            raise ValueError("目标分组已不存在，请重新选择")
        existing = next(
            (j for j in registry["journals"] if same_journal(candidate, j)), None
        )
        journal = existing or {
            **copy.deepcopy(candidate),
            "groups": [],
            "user_added": True,
        }
        local = copy.deepcopy(self.local)
        if not existing:
            local["journals"].append(journal)
        if group_id:
            group = copy.deepcopy(
                next(g for g in registry["groups"] if g["id"] == group_id)
            )
            group["journal_ids"] = list(
                dict.fromkeys([*group["journal_ids"], journal["id"]])
            )
            local["groups"][group_id] = group
        self.save(local)
        return journal, bool(existing)
