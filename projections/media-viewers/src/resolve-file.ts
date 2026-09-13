import { readResolveMember, readResolveTarget, type WireReader } from '@arsumbris/au-host-sdk/engine-reads'

/** Keep external opening behind the same indexed-file gate as a reference lookup. */
export async function resolveExternalFile(reader: WireReader, file: string): Promise<string | null> {
  const path=file.replaceAll('\\','/')
  const absolute=path.startsWith('/')||/^[a-z]:\//i.test(path)
  let reference=file
  if(absolute){
    const owner=await readResolveMember(reader,file)
    if(!('ready' in owner)||!owner.ready||!owner.result)return null
    const prefix=owner.result.root.replaceAll('\\','/').replace(/\/$/,'')+'/'
    if(!path.startsWith(prefix))return null
    const local=path.slice(prefix.length)
    if(!local||local.split('/').some(part=>!part||part==='.'||part==='..'))return null
    reference=`${local}::${owner.result.repo}`
  }
  const resolved=await readResolveTarget(reader,reference)
  if(!('ready' in resolved)||!resolved.ready||!resolved.result)return null
  if(absolute&&resolved.result.path.replaceAll('\\','/')!==path)return null
  return resolved.result.path
}
