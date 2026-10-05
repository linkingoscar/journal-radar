# 界面材质与动效的实现

采用现有原生 JavaScript/CSS 技术栈，保留期刊封面、学术正文衬线字体和墨绿品牌色。调整导航位置、背景、留白、圆角和层级，让材质服务于浏览与阅读。

## 布局与材质的使用原则

[Apple 的 Liquid Glass 适配指南](https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass)将这种材质用于导航与操作层，要求避免玻璃叠玻璃；[HIG 材质指南](https://developer.apple.com/design/human-interface-guidelines/materials)区分操作层与内容层，强调可读性和节制使用。本项目对应为：

- 桌面端的主要浏览导航、状态和刷新合并到一个悬浮顶部栏；导航不再单独叠一层玻璃。
- 手机端的三个主要入口采用带图标与标签的底部悬浮导航，内容末尾预留空间；顶部仅保留状态与刷新。位置参考 [Apple Tab bars](https://developer.apple.com/design/human-interface-guidelines/tab-bars) 和 [Apple 开发者案例中的 Sky Guide](https://developer.apple.com/videos/play/meet-with-apple/208/) 对单手操作的调整。
- 阅读器的标题栏与上一篇/下一篇操作栏各自形成独立功能层，滚动正文从其下方经过。弹窗主体、文章卡片、期刊封面、摘要、笔记、引用均保持实底。
- 筛选、阅读状态、卡片/列表选择使用普通分段控件，仅共享弹簧选中反馈。普通按钮保持标准填色或轮廓样式。

优先采用可读性较高的染色玻璃，配合细轮廓、柔和阴影、圆角连续关系与克制高光。底部导航与阅读操作保持明确边界；材质不会处理前景文字。浅色模式改为冷中性背景和白色内容面，深色模式沿用清晰的层级。

## 两个参考项目如何落到代码

| 固定版本来源                                                                                                                                          | 实际采用的机制                                                                                    | 应用位置                                                                                              |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| [GetStream/swiftui-spring-animations · 302d041](https://github.com/GetStream/swiftui-spring-animations/tree/302d0417e4864660d674701ecf2e805519cc912c) | 参考 smooth/snappy 的用途、初速度与中途改向的位置和速度接续；基于弹簧方程独立实现 Web 积分器      | `radar/web/motion.js`；侧栏分组、浏览方式、卡片/列表、阅读状态与往期/近期选择滑块；页面进入和连续阅读 |
| [rdev/liquid-glass-react · ac48eab](https://github.com/rdev/liquid-glass-react/tree/ac48eab18d1f7f444ae30002d240cae29c863a21)                         | 改编 GlassFilter 的独立背景层、RGB 位移、边缘色散与中心合成；借鉴指针方向高光、弹性形变和按压反馈 | `radar/web/materials.js`、`style.css`；悬浮顶部栏、手机底部导航、弹窗标题栏和阅读底部工具栏           |

GetStream 的 SwiftUI 源码没有纳入应用；其示例用于理解交互机制。Web 弹簧采用质量为 1 的运动方程，选中滑块使用刚度 540、阻尼 32，阅读进入使用刚度 420、阻尼 41。这些是本项目调节的参数，并非 Apple 的预设数值。改变目标时保留已有位置和速度，不排队播放动画；停稳后停止请求帧。分段积分和最大时间步限制用于处理后台恢复时的长帧。

rdev 的 MIT 授权全文保留在 `radar/web/liquid-glass-LICENSE.txt`。玻璃的位移贴图按当前控件的圆角与尺寸生成，R/B 表示方向、G 表示边缘强度；只在边缘区域混合轻微色散，中心保留原背景。尺寸变化时重新生成贴图，指针移动只更新高光和背景变形。滤镜、透明染色和前景文字分别处于独立层，避免文字被折射或把实色染色层拉成生硬的亮边。

## 浏览器与偏好

Chromium/Edge 在支持背景滤镜时启用 SVG 折射。rdev 的固定版本明确记录 Safari、Firefox 无法显示位移；这些浏览器采用模糊、透明染色、轮廓高光和弹簧反馈。未支持背景滤镜的环境使用基础表面。弹窗保留原生对话框语义；支持离散转场的浏览器平滑退出，其他浏览器直接关闭。

系统减少动态效果和应用内「简化界面效果」同时控制 CSS 与 JavaScript 动效，包括正在运行的弹簧。减少透明度、增强对比度、强制颜色与手动简化采用实色操作层。读取系统偏好的支持程度依浏览器而异，手动开关始终可用。

交互弹簧使用 `requestAnimationFrame` 更新位移和缩放。原生弹窗使用带小幅回弹的 CSS `linear()` 曲线，旧浏览器回退到已有 easing；它不提供交互弹簧的速度接续。实现参考 [MDN linear()](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/easing-function/linear)，支持情况按目标浏览器实测。

## 验证范围

`radar/test_motion.cjs` 验证改向的速度连续、最终目标、不同弹簧的过冲与单调性、减少效果立即停止及长帧恢复；离线测试覆盖新增资源。视觉与交互验证应覆盖 Chromium、WebKit、日夜模式、窄屏、滚动、连续阅读、焦点返回和效果偏好。

Windows WebKit 的 iPhone 尺寸模拟不能代替 iOS 真机的性能或高刷新率验证。本次环境在 WebKit 官方模糊示例中也未呈现背景模糊，因此仅用它核对布局、交互和偏好，Safari 的材质渲染仍需真机复核。Chromium 的背景模糊与边缘折射已通过实际渲染对照确认。本实现不等同于 Apple 原生 Liquid Glass 渲染器。
