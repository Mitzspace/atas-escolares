import type { Dispatch, SetStateAction } from 'react'
import type { Anotacao, ModoRegistro } from '../ata-api'
import Gravador from './Gravador'

type Props = {
  modoRegistro: ModoRegistro
  setModoRegistro: Dispatch<SetStateAction<ModoRegistro>>
  anotacoes: Anotacao[]
  setAnotacoes: Dispatch<SetStateAction<Anotacao[]>>
  audio: File | null
  onAudio: (audio: File | null, sessao?: string) => void
  tempoMs: number
  setTempoMs: Dispatch<SetStateAction<number>>
  gravando: boolean
  setGravando: Dispatch<SetStateAction<boolean>>
  salvando: boolean
  salvoAutomatico: boolean
}
export default function RegistroReuniao({
  modoRegistro,
  setModoRegistro,
  anotacoes,
  setAnotacoes,
  audio,
  onAudio,
  tempoMs,
  setTempoMs,
  gravando,
  setGravando,
  salvando,
  salvoAutomatico,
}: Props) {
  return (
    <>
      <fieldset className="space-y-3" disabled={gravando || salvando}>
        <legend className="mb-3 font-document text-xl font-semibold">
          Como deseja registrar?
        </legend>
        <div className="grid gap-3 sm:grid-cols-3">
          {(
            [
              ['audio', 'Gravar áudio', 'Grave agora ou envie um arquivo.'],
              [
                'digitar',
                'Digitar',
                'Escreva o texto ou as anotações, mesmo sem internet.',
              ],
              [
                'audio_digitar',
                'Gravar e digitar',
                'Grave enquanto anota nomes, números e decisões.',
              ],
            ] as const
          ).map(([modo, titulo, descricao]) => (
            <label
              key={modo}
              className={`min-h-32 cursor-pointer rounded-xl border p-4 ${modoRegistro === modo ? 'border-blue-800 bg-blue-50' : 'border-rule bg-white'}`}
            >
              <span className="flex items-center gap-3 font-semibold">
                <input
                  type="radio"
                  aria-label={titulo}
                  name="modo-registro"
                  value={modo}
                  checked={modoRegistro === modo}
                  onChange={() => setModoRegistro(modo)}
                />
                {titulo}
              </span>
              <span className="mt-2 block text-sm text-slate-600">
                {descricao}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <section className="card space-y-5">
        <h2 className="font-semibold">
          {modoRegistro === 'digitar'
            ? 'Texto e anotações da reunião'
            : 'Registro da reunião'}
        </h2>
        {modoRegistro !== 'digitar' && (
          <Gravador
            compacto={modoRegistro === 'audio_digitar'}
            onTempo={setTempoMs}
            onAndamento={setGravando}
            arquivo={audio}
            onChange={onAudio}
          />
        )}
        {modoRegistro !== 'audio' && (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              {modoRegistro === 'digitar'
                ? 'Seu texto fica salvo automaticamente neste aparelho. Ao terminar, organize com IA ou use como está, sem IA.'
                : 'Registre nomes, números e decisões. As anotações têm prioridade sobre o áudio; divergências aparecerão para confirmar.'}
            </p>
            {anotacoes.map((a, i) => (
              <div key={i} className="space-y-2">
                <label htmlFor={`anotacao-${i}`} className="label">
                  {modoRegistro === 'digitar'
                    ? 'Texto da reunião'
                    : `Anotação ${i + 1}`}
                  {a.tempo && (
                    <span className="ml-2 font-mono text-blue-900">
                      [{a.tempo}]
                    </span>
                  )}
                </label>
                <textarea
                  id={`anotacao-${i}`}
                  className="field min-h-36"
                  rows={modoRegistro === 'digitar' ? 12 : 4}
                  value={a.texto}
                  onChange={(e) => {
                    const texto = e.target.value
                    setAnotacoes((as) =>
                      as.map((x, j) =>
                        j === i
                          ? {
                              ...x,
                              texto,
                              ...(modoRegistro === 'audio_digitar' && !x.tempo
                                ? {
                                    tempo: `${String(Math.floor(tempoMs / 60000)).padStart(2, '0')}:${String(Math.floor(tempoMs / 1000) % 60).padStart(2, '0')}`,
                                  }
                                : {}),
                            }
                          : x,
                      ),
                    )
                  }}
                />
              </div>
            ))}
            {modoRegistro === 'audio_digitar' && (
              <button
                type="button"
                className="btn-secondary w-full"
                onClick={() => setAnotacoes((as) => [...as, { texto: '' }])}
              >
                ＋ Adicionar anotação
              </button>
            )}
            <p className="text-sm text-slate-600" role="status">
              {salvoAutomatico
                ? 'Anotações salvas neste aparelho.'
                : 'As anotações são salvas automaticamente.'}
            </p>
          </div>
        )}
      </section>
    </>
  )
}
