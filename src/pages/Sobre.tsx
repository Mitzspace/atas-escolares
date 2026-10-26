import { Link } from 'react-router-dom'
import MarcaApp from '../components/MarcaApp'
export default function Sobre() {
  return <div className="space-y-6">
    <div><p className="eyebrow mb-2">EMPLMS</p><h1>Sobre o Ata Inteligente</h1></div>
    <div className="card"><MarcaApp className="mx-auto h-auto w-full max-w-lg" /></div>
    <section className="card space-y-4">
      <h2>Da reunião ao registro da escola</h2>
      <p>O Ata Inteligente foi preparado para uso exclusivo da Escola Municipal Professora Luiza Maria de Souza (EMPLMS).</p>
      <p>Registre a reunião, confira o conteúdo e prepare a ata para impressão e assinatura.</p>
      <p>Seus registros ficam neste aparelho. Guarde um backup para recuperar suas atas em outro navegador ou celular.</p>
      <Link to="/config?backup=1" className="btn-secondary w-full">Configurações e backup</Link>
    </section>
  </div>
}
