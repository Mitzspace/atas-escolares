export default function AvisoModeloEconomico({ modelo }: { modelo?: string }) {
  if (!modelo || !/(?:^|-)lite(?:-|$)/i.test(modelo)) return null
  return (
    <p role="status" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-900">
      Esta ata foi redigida por um modelo econômico; revise com atenção.
    </p>
  )
}
