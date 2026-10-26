import 'fake-indexeddb/auto'
import { beforeEach, expect, it } from 'vitest'
import { db, finalizarAta, patchAta, reabrirAta, criarBackup, restaurarBackup } from './db'
import type { AtaRecord } from './types'
const ata: AtaRecord = {
 id:'revisao', criadaEm:1, atualizadaEm:1, status:'ata',
 meta:{ escola:'E',rede:'R',municipioUf:'X',tipo:'pedagogica',ordinaria:true,numero:1,ano:2026,data:'2026-10-25',horaInicio:'14:00',local:'Sala',presidente:{nome:'A',cargo:'Diretora'},secretario:{nome:'B',cargo:'Secretária'},participantes:[],pauta:[],anonimizarAlunos:true },
 renderizada:{ titulo:'Ata',cabecalho:['E'],texto:'A reunião foi encerrada.',assinaturas:[],pendencias:[] },
 modoRegistro:'digitar',anotacoes:[{texto:'Texto inicial',tempo:'01:25'}],resumo:{assuntos:['Pauta'],decisoes:[],encaminhamentos:[]},
}
beforeEach(async()=>{await db.atas.clear();await db.atas.put(ata)})
it.each(['[PENDENTE]','[confirmar: prazo]','[inaudível]'])('bloqueia finalização com %s mesmo com confirmação',async marcador=>{
 await expect(finalizarAta(ata.id,'Texto '+marcador,true)).rejects.toThrow(/pendentes/)
 expect((await db.atas.get(ata.id))?.finalizadaEm).toBeUndefined()
})
it('exige confirmação, guarda texto final, impede edições e registra cada reabertura',async()=>{
 await expect(finalizarAta(ata.id,'Texto.',false)).rejects.toThrow(/revisou/)
 const final=await finalizarAta(ata.id,'Texto revisado.',true)
 expect(final.finalizadaEm).toBeGreaterThan(0)
 await expect(patchAta(ata.id,{textoEditado:'Alteração proibida'})).rejects.toThrow(/Reabra/)
 expect((await db.atas.get(ata.id))?.textoEditado).toBe('Texto revisado.')
 const aberta=await reabrirAta(ata.id)
 expect(aberta.finalizadaEm).toBeUndefined()
 expect(aberta.reabertaEm).toHaveLength(1)
 await patchAta(ata.id,{textoEditado:'Correção.'})
 await finalizarAta(ata.id,'Correção.',true)
 expect((await reabrirAta(ata.id)).reabertaEm).toHaveLength(2)
})
it('backup preserva modo, anotações, resumo e datas de finalização/reabertura',async()=>{
 await finalizarAta(ata.id,'Texto.',true);await reabrirAta(ata.id);await finalizarAta(ata.id,'Corrigido.',true)
 const antes=await db.atas.get(ata.id), backup=await criarBackup()
 await restaurarBackup(backup,{modo:'substituir',substituirConfiguracoes:false,incluirChaves:false})
 expect(await db.atas.get(ata.id)).toEqual(antes)
})
