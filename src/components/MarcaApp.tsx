/** Derivadas otimizadas da marca oficial enviada pela escola; sem redesenho. */
export default function MarcaApp({ compacta = false, className = '' }: { compacta?: boolean; className?: string }) {
  const base = `${import.meta.env.BASE_URL}marca/ata-inteligente${compacta ? '-compacta' : ''}`
  return <picture><source srcSet={`${base}.webp`} type="image/webp" /><img src={`${base}.png`} alt="Ata Inteligente — EMPLMS" className={className} width={600} height={compacta ? 289 : 349} /></picture>
}
