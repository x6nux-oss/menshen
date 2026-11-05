/**
 * 折射滤镜的 SVG 定义，每个页面渲染一次（放在外壳根部）。
 * 用 feDisplacementMap 对背景做边缘位移 —— 这是「液态玻璃」折射感的来源。
 * 不支持该特性的浏览器会忽略引用它的 backdrop-filter，自动退回 Layer 1+2。
 */
export function GlassFilterDefs() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }}
    >
      <defs>
        <filter id="menshen-glass-refract" x="-20%" y="-20%" width="140%" height="140%">
          {/* 低频噪声当作位移图：边缘处梯度大 → 位移明显，中心平缓 → 几乎不变形 */}
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.008 0.008"
            numOctaves="2"
            seed="7"
            result="noise"
          />
          <feGaussianBlur in="noise" stdDeviation="2" result="softNoise" />
          <feDisplacementMap
            in="SourceGraphic"
            in2="softNoise"
            scale="42"
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
      </defs>
    </svg>
  )
}
