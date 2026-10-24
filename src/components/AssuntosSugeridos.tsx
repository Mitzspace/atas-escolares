import { alternarAssunto, assuntoJaUsado } from '../assuntos'

type Props = {
  sugestoes: string[]
  pauta: string[]
  onChange: (pauta: string[]) => void
}

/** chips grandes: tocar adiciona o assunto à pauta, tocar de novo remove */
export default function AssuntosSugeridos({ sugestoes, pauta, onChange }: Props) {
  if (!sugestoes.length) return null
  return (
    <div className="space-y-4 rounded-2xl border border-blue-100 bg-blue-50/40 p-4">
      <p className="font-semibold text-ink">Sugestões — toque para adicionar</p>
      <ul className="flex flex-wrap gap-3" aria-label="Sugestões de assuntos">
        {sugestoes.map(a => {
          const usado = assuntoJaUsado(pauta, a)
          return (
            <li key={a} className="max-w-full">
              <button
                type="button" aria-pressed={usado} onClick={() => onChange(alternarAssunto(pauta, a))}
                className="subject-chip"
              ><span className="chip-mark" aria-hidden="true">{usado ? '✓' : '+'}</span><span className="min-w-0 break-words">{a}</span></button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
