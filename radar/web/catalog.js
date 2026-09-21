'use strict';
// Metadata and covers from linkingoscar/paper, with additional covers from Third Iron.
// Source URLs and retrieval details: radar/CATALOG_SOURCES.md.
const JOURNAL_CATALOG = {
  "1941-6520": {
    "cover": "cover-1941-6520.jpg",
    "discipline": "ETHICS-CSR-MAN、一般管理",
    "ratings": [
      {
        "catalog": "FMS(Global)",
        "level": "B",
        "year": "2025"
      },
      {
        "catalog": "ABS",
        "level": "4*",
        "year": "2024"
      }
    ]
  },
  "0001-4273": {
    "cover": "cover-0001-4273.jpg",
    "discipline": "ETHICS-CSR-MAN、一般管理",
    "ratings": [
      {
        "catalog": "FMS(Global)",
        "level": "A",
        "year": "2025"
      },
      {
        "catalog": "ABS",
        "level": "4*",
        "year": "2024"
      }
    ]
  },
  "0363-7425": {
    "cover": "cover-0363-7425.jpg",
    "discipline": "ETHICS-CSR-MAN、一般管理",
    "ratings": [
      {
        "catalog": "FMS(Global)",
        "level": "A",
        "year": "2025"
      },
      {
        "catalog": "ABS",
        "level": "4*",
        "year": "2024"
      }
    ]
  },
  "0001-4826": {
    "cover": "cover-0001-4826.png",
    "discipline": "ACCOUNT、会计",
    "ratings": [
      {
        "catalog": "FMS(Global)",
        "level": "A",
        "year": "2025"
      },
      {
        "catalog": "ABS",
        "level": "4*",
        "year": "2024"
      }
    ]
  },
  "0361-3682": {
    "cover": "cover-0361-3682.jpg",
    "discipline": "ACCOUNT、会计",
    "ratings": [
      {
        "catalog": "FMS(Global)",
        "level": "A",
        "year": "2025"
      },
      {
        "catalog": "ABS",
        "level": "4*",
        "year": "2024"
      }
    ]
  },
  "0001-8392": {
    "cover": "cover-0001-8392.webp",
    "discipline": "ETHICS-CSR-MAN、一般管理",
    "ratings": [
      {
        "catalog": "FMS(Global)",
        "level": "A",
        "year": "2025"
      },
      {
        "catalog": "ABS",
        "level": "4*",
        "year": "2024"
      }
    ]
  },
  "0002-8282": {
    "cover": "cover-0002-8282.jpg",
    "discipline": "ECON、一般经济",
    "ratings": [
      {
        "catalog": "FMS(Global)",
        "level": "A",
        "year": "2025"
      },
      {
        "catalog": "ABS",
        "level": "4*",
        "year": "2024"
      }
    ]
  },
  "0003-1224": {
    "cover": "cover-0003-1224.jpg",
    "discipline": "SOC SCI",
    "ratings": [
      {
        "catalog": "ABS",
        "level": "4*",
        "year": "2024"
      }
    ]
  },
  "0823-9150": {
    "cover": "cover-0823-9150.jpg",
    "discipline": "ACCOUNT、会计",
    "ratings": [
      {
        "catalog": "FMS(Global)",
        "level": "A",
        "year": "2025"
      },
      {
        "catalog": "ABS",
        "level": "4",
        "year": "2024"
      }
    ]
  },
  "0012-9682": {
    "cover": "cover-0012-9682.jpg",
    "discipline": "ECON、一般经济",
    "ratings": [
      {
        "catalog": "FMS(Global)",
        "level": "A",
        "year": "2025"
      },
      {
        "catalog": "ABS",
        "level": "4*",
        "year": "2024"
      }
    ]
  },
  "1042-2587": {
    "cover": "cover-1042-2587.jpg",
    "discipline": "ENT-SBM、创业与中小企业管理",
    "ratings": [
      {
        "catalog": "FMS(Global)",
        "level": "A",
        "year": "2025"
      },
      {
        "catalog": "ABS",
        "level": "4*",
        "year": "2024"
      }
    ]
  },
  "0017-8012": {
    "cover": "cover-0017-8012.webp",
    "discipline": "ETHICS-CSR-MAN、一般管理",
    "ratings": [
      {
        "catalog": "FMS(Global)",
        "level": "B",
        "year": "2025"
      },
      {
        "catalog": "ABS",
        "level": "3",
        "year": "2024"
      }
    ]
  },
  "0090-4848": {
    "cover": "cover-0090-4848.jpg",
    "discipline": "HRM&EMP、人力资源管理",
    "ratings": [
      {
        "catalog": "FMS(Global)",
        "level": "A",
        "year": "2025"
      },
      {
        "catalog": "ABS",
        "level": "4",
        "year": "2024"
      }
    ]
  },
  "1047-7047": {
    "cover": "cover-1047-7047.jpg",
    "discipline": "INFO MAN、信息管理",
    "ratings": [
      {
        "catalog": "FMS(Global)",
        "level": "A",
        "year": "2025"
      },
      {
        "catalog": "ABS",
        "level": "4*",
        "year": "2024"
      }
    ]
  },
  "0165-4101": {
    "cover": "cover-0165-4101.jpg",
    "discipline": "ACCOUNT、会计",
    "ratings": [
      {
        "catalog": "FMS(Global)",
        "level": "A",
        "year": "2025"
      },
      {
        "catalog": "ABS",
        "level": "4*",
        "year": "2024"
      }
    ]
  },
  "0021-8456": {
    "cover": "cover-0021-8456.jpg",
    "discipline": "ACCOUNT、会计",
    "ratings": [
      {
        "catalog": "FMS(Global)",
        "level": "A",
        "year": "2025"
      },
      {
        "catalog": "ABS",
        "level": "4*",
        "year": "2024"
      }
    ]
  },
  "0021-9010": {
    "cover": "cover-0021-9010.jpg",
    "discipline": "PSYCH (WOP-OB)、心理学",
    "ratings": [
      {
        "catalog": "FMS(Global)",
        "level": "A",
        "year": "2025"
      },
      {
        "catalog": "ABS",
        "level": "4*",
        "year": "2024"
      }
    ]
  },
  "0883-9026": {
    "cover": "cover-0883-9026.jpg",
    "discipline": "ENT-SBM、创业与中小企业管理",
    "ratings": [
      {
        "catalog": "FMS(Global)",
        "level": "A",
        "year": "2025"
      },
      {
        "catalog": "ABS",
        "level": "4*",
        "year": "2024"
      }
    ]
  },
  "1057-7408": {
    "cover": "cover-1057-7408.jpg",
    "discipline": "MKT、营销",
    "ratings": [
      {
        "catalog": "FMS(Global)",
        "level": "B",
        "year": "2025"
      },
      {
        "catalog": "ABS",
        "level": "4*",
        "year": "2024"
      }
    ]
  },
  "0093-5301": {
    "cover": "cover-0093-5301.jpg",
    "discipline": "MKT、营销",
    "ratings": [
      {
        "catalog": "FMS(Global)",
        "level": "A",
        "year": "2025"
      },
      {
        "catalog": "ABS",
        "level": "4*",
        "year": "2024"
      }
    ]
  },
  "0022-1082": {
    "cover": "cover-0022-1082.jpg",
    "discipline": "FINANCE、金融",
    "ratings": [
      {
        "catalog": "FMS(Global)",
        "level": "A",
        "year": "2025"
      },
      {
        "catalog": "ABS",
        "level": "4*",
        "year": "2024"
      }
    ]
  },
  "0022-1090": {
    "cover": "cover-0022-1090.jpg",
    "discipline": "FINANCE、金融",
    "ratings": [
      {
        "catalog": "FMS(Global)",
        "level": "A",
        "year": "2025"
      },
      {
        "catalog": "ABS",
        "level": "4",
        "year": "2024"
      }
    ]
  },
  "0304-405X": {
    "cover": "cover-0304-405X.jpg",
    "discipline": "FINANCE、金融",
    "ratings": [
      {
        "catalog": "FMS(Global)",
        "level": "A",
        "year": "2025"
      },
      {
        "catalog": "ABS",
        "level": "4*",
        "year": "2024"
      }
    ]
  },
  "0047-2506": {
    "cover": "cover-0047-2506.jpg",
    "discipline": "IB&AREA、国际商务国际事务",
    "ratings": [
      {
        "catalog": "FMS(Global)",
        "level": "A",
        "year": "2025"
      },
      {
        "catalog": "ABS",
        "level": "4*",
        "year": "2024"
      }
    ]
  },
  "0149-2063": {
    "cover": "cover-0149-2063.jpg",
    "discipline": "ETHICS-CSR-MAN、一般管理",
    "ratings": [
      {
        "catalog": "FMS(Global)",
        "level": "A",
        "year": "2025"
      },
      {
        "catalog": "ABS",
        "level": "4*",
        "year": "2024"
      }
    ]
  },
  "0742-1222": {
    "cover": "cover-0742-1222.jpg",
    "discipline": "INFO MAN、信息管理",
    "ratings": [
      {
        "catalog": "FMS(Global)",
        "level": "A",
        "year": "2025"
      },
      {
        "catalog": "ABS",
        "level": "4",
        "year": "2024"
      }
    ]
  },
  "0022-2380": {
    "cover": "cover-0022-2380.jpg",
    "discipline": "ETHICS-CSR-MAN、一般管理",
    "ratings": [
      {
        "catalog": "FMS(Global)",
        "level": "A",
        "year": "2025"
      },
      {
        "catalog": "ABS",
        "level": "4",
        "year": "2024"
      }
    ]
  },
  "0022-2429": {
    "cover": "cover-0022-2429.jpg",
    "discipline": "MKT、营销",
    "ratings": [
      {
        "catalog": "FMS(Global)",
        "level": "A",
        "year": "2025"
      },
      {
        "catalog": "ABS",
        "level": "4*",
        "year": "2024"
      }
    ]
  },
  "0022-2437": {
    "cover": "cover-0022-2437.jpg",
    "discipline": "MKT、营销",
    "ratings": [
      {
        "catalog": "FMS(Global)",
        "level": "A",
        "year": "2025"
      },
      {
        "catalog": "ABS",
        "level": "4*",
        "year": "2024"
      }
    ]
  },
  "0272-6963": {
    "cover": "cover-0272-6963.jpg",
    "discipline": "OPS&TECH、运营管理",
    "ratings": [
      {
        "catalog": "FMS(Global)",
        "level": "A",
        "year": "2025"
      },
      {
        "catalog": "ABS",
        "level": "4*",
        "year": "2024"
      }
    ]
  },
  "0022-3808": {
    "cover": "cover-0022-3808.jpg",
    "discipline": "ECON、一般经济",
    "ratings": [
      {
        "catalog": "FMS(Global)",
        "level": "A",
        "year": "2025"
      },
      {
        "catalog": "ABS",
        "level": "4*",
        "year": "2024"
      }
    ]
  },
  "0092-0703": {
    "cover": "cover-0092-0703.jpg",
    "discipline": "MKT、营销",
    "ratings": [
      {
        "catalog": "FMS(Global)",
        "level": "B",
        "year": "2025"
      },
      {
        "catalog": "ABS",
        "level": "4*",
        "year": "2024"
      }
    ]
  },
  "0025-1909": {
    "cover": "cover-0025-1909.jpg",
    "discipline": "OR&MANSCI、一般管理",
    "ratings": [
      {
        "catalog": "FMS(Global)",
        "level": "A",
        "year": "2025"
      },
      {
        "catalog": "ABS",
        "level": "4*",
        "year": "2024"
      }
    ]
  },
  "1523-4614": {
    "cover": "cover-1523-4614.jpg",
    "discipline": "OPS&TECH、运营管理",
    "ratings": [
      {
        "catalog": "FMS(Global)",
        "level": "A",
        "year": "2025"
      },
      {
        "catalog": "ABS",
        "level": "3",
        "year": "2024"
      }
    ]
  },
  "0732-2399": {
    "cover": "cover-0732-2399.jpg",
    "discipline": "MKT、营销",
    "ratings": [
      {
        "catalog": "FMS(Global)",
        "level": "A",
        "year": "2025"
      },
      {
        "catalog": "ABS",
        "level": "4*",
        "year": "2024"
      }
    ]
  },
  "0276-7783": {
    "cover": "cover-0276-7783.png",
    "discipline": "INFO MAN、信息管理",
    "ratings": [
      {
        "catalog": "FMS(Global)",
        "level": "A",
        "year": "2025"
      },
      {
        "catalog": "ABS",
        "level": "4*",
        "year": "2024"
      }
    ]
  },
  "1532-9194": {
    "cover": "cover-1532-9194.jpg",
    "discipline": "ETHICS-CSR-MAN、一般管理",
    "ratings": [
      {
        "catalog": "FMS(Global)",
        "level": "B",
        "year": "2025"
      },
      {
        "catalog": "ABS",
        "level": "3",
        "year": "2024"
      }
    ]
  },
  "0030-364X": {
    "cover": "cover-0030-364X.jpg",
    "discipline": "OR&MANSCI、运筹与管理",
    "ratings": [
      {
        "catalog": "FMS(Global)",
        "level": "A",
        "year": "2025"
      },
      {
        "catalog": "ABS",
        "level": "4*",
        "year": "2024"
      }
    ]
  },
  "1047-7039": {
    "cover": "cover-1047-7039.jpg",
    "discipline": "ORG STUD、组织管理",
    "ratings": [
      {
        "catalog": "FMS(Global)",
        "level": "A",
        "year": "2025"
      },
      {
        "catalog": "ABS",
        "level": "4*",
        "year": "2024"
      }
    ]
  },
  "0749-5978": {
    "cover": "cover-0749-5978.jpg",
    "discipline": "PSYCH (WOP-OB)、心理学",
    "ratings": [
      {
        "catalog": "FMS(Global)",
        "level": "A",
        "year": "2025"
      },
      {
        "catalog": "ABS",
        "level": "4",
        "year": "2024"
      }
    ]
  },
  "1059-1478": {
    "cover": "cover-1059-1478.jpg",
    "discipline": "OPS&TECH、运营管理",
    "ratings": [
      {
        "catalog": "FMS(Global)",
        "level": "A",
        "year": "2025"
      },
      {
        "catalog": "ABS",
        "level": "4",
        "year": "2024"
      }
    ]
  },
  "0956-7976": {
    "cover": "cover-0956-7976.jpg",
    "discipline": "PSYCH (GENERAL)、心理学",
    "ratings": [
      {
        "catalog": "FMS(Global)",
        "level": "A",
        "year": "2025"
      },
      {
        "catalog": "ABS",
        "level": "4*",
        "year": "2024"
      }
    ]
  },
  "0033-5533": {
    "cover": "cover-0033-5533.jpg",
    "discipline": "ECON、一般经济",
    "ratings": [
      {
        "catalog": "FMS(Global)",
        "level": "A",
        "year": "2025"
      },
      {
        "catalog": "ABS",
        "level": "4*",
        "year": "2024"
      }
    ]
  },
  "0048-7333": {
    "cover": "cover-0048-7333.jpg",
    "discipline": "INNOV、科技创新管理",
    "ratings": [
      {
        "catalog": "FMS(Global)",
        "level": "A",
        "year": "2025"
      },
      {
        "catalog": "ABS",
        "level": "4*",
        "year": "2024"
      }
    ]
  },
  "1380-6653": {
    "cover": "cover-1380-6653.jpg",
    "discipline": "ACCOUNT、会计",
    "ratings": [
      {
        "catalog": "FMS(Global)",
        "level": "A",
        "year": "2025"
      },
      {
        "catalog": "ABS",
        "level": "4",
        "year": "2024"
      }
    ]
  },
  "0034-6527": {
    "cover": "cover-0034-6527.jpg",
    "discipline": "ECON、一般经济",
    "ratings": [
      {
        "catalog": "FMS(Global)",
        "level": "A",
        "year": "2025"
      },
      {
        "catalog": "ABS",
        "level": "4*",
        "year": "2024"
      }
    ]
  },
  "1572-3097": {
    "cover": "cover-1572-3097.jpeg",
    "discipline": "FINANCE、金融",
    "ratings": [
      {
        "catalog": "FMS(Global)",
        "level": "A",
        "year": "2025"
      },
      {
        "catalog": "ABS",
        "level": "4",
        "year": "2024"
      }
    ]
  },
  "0893-9454": {
    "cover": "cover-0893-9454.jpeg",
    "discipline": "FINANCE、金融",
    "ratings": [
      {
        "catalog": "FMS(Global)",
        "level": "A",
        "year": "2025"
      },
      {
        "catalog": "ABS",
        "level": "4*",
        "year": "2024"
      }
    ]
  },
  "1932-4391": {
    "cover": "cover-1932-4391.jpg",
    "discipline": "ENT-SBM、创业与中小企业管理",
    "ratings": [
      {
        "catalog": "FMS(Global)",
        "level": "A",
        "year": "2025"
      },
      {
        "catalog": "ABS",
        "level": "4",
        "year": "2024"
      }
    ]
  },
  "0143-2095": {
    "cover": "cover-0143-2095.jpg",
    "discipline": "STRAT、战略管理",
    "ratings": [
      {
        "catalog": "FMS(Global)",
        "level": "A",
        "year": "2025"
      },
      {
        "catalog": "ABS",
        "level": "4*",
        "year": "2024"
      }
    ]
  },
  "0031-5826": {
    "cover": "cover-0031-5826.jpg",
    "discipline": "PSYCH (WOP-OB)、心理学",
    "ratings": [
      {
        "catalog": "FMS(Global)",
        "level": "A",
        "year": "2025"
      },
      {
        "catalog": "ABS",
        "level": "4*",
        "year": "2024"
      }
    ]
  },
  "0954-5395": {
    "cover": "cover-0954-5395.jpg",
    "discipline": "HRM&EMP、人力资源管理",
    "ratings": [
      {
        "catalog": "FMS(Global)",
        "level": "A",
        "year": "2025"
      },
      {
        "catalog": "ABS",
        "level": "4*",
        "year": "2024"
      }
    ]
  },
  "0958-5192": {
    "cover": "cover-0958-5192.jpg",
    "discipline": "HRM&EMP、人力资源管理",
    "ratings": [
      {
        "catalog": "FMS(Global)",
        "level": "B",
        "year": "2025"
      },
      {
        "catalog": "ABS",
        "level": "3",
        "year": "2024"
      }
    ]
  },
  "0894-3796": {
    "cover": "cover-0894-3796.jpg",
    "discipline": "PSYCH (WOP-OB)、组织管理",
    "ratings": [
      {
        "catalog": "FMS(Global)",
        "level": "A",
        "year": "2025"
      },
      {
        "catalog": "ABS",
        "level": "4",
        "year": "2024"
      }
    ]
  },
  "1091-9856": {
    "cover": "cover-1091-9856.jpg",
    "discipline": "OR&MANSCI、运筹与管理",
    "ratings": [
      {
        "catalog": "FMS(Global)",
        "level": "A",
        "year": "2025"
      },
      {
        "catalog": "ABS",
        "level": "3",
        "year": "2024"
      }
    ]
  },
  "0148-2963": {
    "cover": "cover-0148-2963.jpg",
    "discipline": "ETHICS-CSR-MAN、一般管理",
    "ratings": [
      {
        "catalog": "FMS(Global)",
        "level": "B",
        "year": "2025"
      },
      {
        "catalog": "ABS",
        "level": "3",
        "year": "2024"
      }
    ]
  },
  "1053-4822": {
    "cover": "cover-1053-4822.jpg",
    "discipline": "HRM&EMP、人力资源管理",
    "ratings": [
      {
        "catalog": "FMS(Global)",
        "level": "B",
        "year": "2025"
      },
      {
        "catalog": "ABS",
        "level": "3",
        "year": "2024"
      }
    ]
  },
  "0001-8791": {
    "cover": "cover-0001-8791.jpg",
    "discipline": "PSYCH (WOP-OB)、心理学",
    "ratings": [
      {
        "catalog": "FMS(Global)",
        "level": "B",
        "year": "2025"
      },
      {
        "catalog": "ABS",
        "level": "4",
        "year": "2024"
      }
    ]
  },
  "0889-3268": {
    "cover": "cover-0889-3268.jpg",
    "discipline": "PSYCH (WOP-OB)、心理学",
    "ratings": [
      {
        "catalog": "FMS(Global)",
        "level": "B",
        "year": "2025"
      },
      {
        "catalog": "ABS",
        "level": "3",
        "year": "2024"
      }
    ]
  },
  "0048-3486": {
    "cover": "cover-0048-3486.png",
    "discipline": "HRM&EMP、人力资源管理",
    "ratings": [
      {
        "catalog": "FMS(Global)",
        "level": "C",
        "year": "2025"
      },
      {
        "catalog": "ABS",
        "level": "2",
        "year": "2024"
      }
    ]
  },
  "0142-5455": {
    "cover": "cover-0142-5455.jpg",
    "discipline": "HRM&EMP、人力资源管理",
    "ratings": [
      {
        "catalog": "FMS(Global)",
        "level": "C",
        "year": "2025"
      },
      {
        "catalog": "ABS",
        "level": "2",
        "year": "2024"
      }
    ]
  },
  "1044-8004": {
    "cover": "cover-1044-8004.jpg",
    "discipline": "HRM&EMP",
    "ratings": [
      {
        "catalog": "ABS",
        "level": "2",
        "year": "2024"
      }
    ]
  },
  "1367-8868": {
    "cover": "cover-1367-8868.jpg",
    "discipline": "HRM&EMP、人力资源管理",
    "ratings": [
      {
        "catalog": "FMS(Global)",
        "level": "C",
        "year": "2025"
      },
      {
        "catalog": "ABS",
        "level": "2",
        "year": "2024"
      }
    ]
  },
  "1038-4111": {
    "cover": "cover-1038-4111.png",
    "discipline": "HRM&EMP、人力资源管理",
    "ratings": [
      {
        "catalog": "FMS(Global)",
        "level": "C",
        "year": "2025"
      },
      {
        "catalog": "ABS",
        "level": "2",
        "year": "2024"
      }
    ]
  },
  "0143-7720": {
    "cover": "cover-0143-7720.png",
    "discipline": "HRM&EMP、人力资源管理",
    "ratings": [
      {
        "catalog": "FMS(Global)",
        "level": "C",
        "year": "2025"
      },
      {
        "catalog": "ABS",
        "level": "2",
        "year": "2024"
      }
    ]
  },
  "0965-075X": {
    "cover": "cover-0965-075X.jpg",
    "discipline": "PSYCH (WOP-OB)、人力资源管理",
    "ratings": [
      {
        "catalog": "FMS(Global)",
        "level": "C",
        "year": "2025"
      },
      {
        "catalog": "ABS",
        "level": "2",
        "year": "2024"
      }
    ]
  },
  "0025-1747": {
    "cover": "cover-0025-1747.jpg",
    "discipline": "ETHICS-CSR-MAN、一般管理",
    "ratings": [
      {
        "catalog": "FMS(Global)",
        "level": "C",
        "year": "2025"
      },
      {
        "catalog": "ABS",
        "level": "2",
        "year": "2024"
      }
    ]
  },
  "2046-9012": {
    "cover": "cover-2046-9012.jpg",
    "discipline": "MDEV&EDU",
    "ratings": [
      {
        "catalog": "ABS",
        "level": "1",
        "year": "2024"
      }
    ]
  },
  "2049-3983": {
    "cover": "cover-2049-3983.jpg",
    "discipline": "HRM&EMP",
    "ratings": [
      {
        "catalog": "ABS",
        "level": "1",
        "year": "2024"
      }
    ]
  },
  "0019-7939": {
    "cover": "cover-0019-7939.jpg",
    "discipline": "HRM&EMP、人力资源管理",
    "ratings": [
      {
        "catalog": "FMS(Global)",
        "level": "B",
        "year": "2025"
      },
      {
        "catalog": "ABS",
        "level": "3",
        "year": "2024"
      }
    ]
  },
  "0018-7267": {
    "cover": "cover-0018-7267.jpg",
    "discipline": "ORG STUD、组织管理",
    "ratings": [
      {
        "catalog": "FMS(Global)",
        "level": "B",
        "year": "2025"
      },
      {
        "catalog": "ABS",
        "level": "4",
        "year": "2024"
      }
    ]
  },
  "1059-6011": {
    "cover": "cover-1059-6011.jpg",
    "discipline": "ORG STUD、组织管理",
    "ratings": [
      {
        "catalog": "FMS(Global)",
        "level": "B",
        "year": "2025"
      },
      {
        "catalog": "ABS",
        "level": "3",
        "year": "2024"
      }
    ]
  },
  "0268-1072": {
    "cover": "cover-0268-1072.jpg",
    "discipline": "HRM&EMP、人力资源管理",
    "ratings": [
      {
        "catalog": "FMS(Global)",
        "level": "B",
        "year": "2025"
      },
      {
        "catalog": "ABS",
        "level": "3",
        "year": "2024"
      }
    ]
  },
  "0268-3946": {
    "cover": "cover-0268-3946.jpg",
    "discipline": "PSYCH (WOP-OB)、心理学",
    "ratings": [
      {
        "catalog": "FMS(Global)",
        "level": "C",
        "year": "2025"
      },
      {
        "catalog": "ABS",
        "level": "3",
        "year": "2024"
      }
    ]
  },
  "1362-0436": {
    "cover": "cover-1362-0436.jpg",
    "discipline": "HRM&EMP",
    "ratings": [
      {
        "catalog": "ABS",
        "level": "2",
        "year": "2024"
      }
    ]
  },
  "0263-2373": {
    "cover": "cover-0263-2373.jpg",
    "discipline": "ETHICS-CSR-MAN、一般管理",
    "ratings": [
      {
        "catalog": "FMS(Global)",
        "level": "C",
        "year": "2025"
      },
      {
        "catalog": "ABS",
        "level": "2",
        "year": "2024"
      }
    ]
  },
  "0217-4561": {
    "cover": "cover-0217-4561.jpg",
    "discipline": "IB&AREA、国际商务国际事务",
    "ratings": [
      {
        "catalog": "FMS(Global)",
        "level": "B",
        "year": "2025"
      },
      {
        "catalog": "ABS",
        "level": "3",
        "year": "2024"
      }
    ]
  },
  "0959-6119": {
    "cover": "cover-0959-6119.jpg",
    "discipline": "SECTOR、旅游管理",
    "ratings": [
      {
        "catalog": "FMS(Global)",
        "level": "B",
        "year": "2025"
      },
      {
        "catalog": "ABS",
        "level": "3",
        "year": "2024"
      }
    ]
  },
  "0167-8116": {
    "cover": "cover-0167-8116.png",
    "discipline": "Marketing",
    "ratings": []
  },
  "0022-4359": {
    "cover": "cover-0022-4359.png",
    "discipline": "Marketing",
    "ratings": []
  },
  "0022-3514": {
    "cover": "cover-0022-3514.png",
    "discipline": "Psychology",
    "ratings": []
  },
  "2378-1815": {
    "cover": "cover-2378-1815.png",
    "discipline": "Marketing",
    "ratings": []
  },
  "0742-6046": {
    "cover": "cover-0742-6046.png",
    "discipline": "Marketing",
    "ratings": []
  },
  "1472-0817": {
    "cover": "cover-1472-0817.png",
    "discipline": "Marketing",
    "ratings": []
  },
  "0923-0645": {
    "cover": "cover-0923-0645.png",
    "discipline": "Marketing",
    "ratings": []
  },
  "0091-3367": {
    "cover": "cover-0091-3367.png",
    "discipline": "Marketing",
    "ratings": []
  },
  "1094-9968": {
    "cover": "cover-1094-9968.png",
    "discipline": "Marketing",
    "ratings": []
  },
  "0743-9156": {
    "cover": "cover-0743-9156.png",
    "discipline": "Marketing",
    "ratings": []
  },
  "0309-0566": {
    "cover": "cover-0309-0566.png",
    "discipline": "Marketing",
    "ratings": []
  },
  "0265-1335": {
    "cover": "cover-0265-1335.png",
    "discipline": "Marketing",
    "ratings": []
  },
  "0969-6989": {
    "cover": "cover-0969-6989.png",
    "discipline": "Marketing",
    "ratings": []
  },
  "1350-231X": {
    "cover": "cover-1350-231X.png",
    "discipline": "Marketing",
    "ratings": []
  },
  "1470-6423": {
    "cover": "cover-1470-6423.png",
    "discipline": "Marketing",
    "ratings": []
  },
  "0265-0487": {
    "cover": "cover-0265-0487.png",
    "discipline": "Marketing",
    "ratings": []
  },
  "0747-5632": {
    "cover": "cover-0747-5632.png",
    "discipline": "Psychology / Human–Computer Interaction",
    "ratings": []
  }
};
