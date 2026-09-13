import type {MountHost} from '@arsumbris/au-host-sdk'
import type {
  AgentProfileData,
  InjectManifest,
  SkillManifest,
  LaunchEnv,
} from '@arsumbris/au-host-app'
export const refBody = (ref: string): string =>
  ref.replace(/^\[\[/, '').replace(/\]\]$/, '')
export const instanceRef = (item: { path: string; owner: string }): string =>
  `[[${item.path
    .split('/')
    .pop()!
    .replace(/\.[^.]+$/, '')}::${item.owner}]]`
export const profileRef = (profile: AgentProfileData): string =>
  `[[${profile.path ?? profile.name}]]`
export async function resolveLaunch(
  profile: AgentProfileData,
  skills: SkillManifest,
  injects: InjectManifest,
  engine: MountHost['engine'],
): Promise<LaunchEnv> {
  const resolve = async (
    refs: string[] | undefined,
    items: Array<{ key: string; path: string; owner: string }>,
    axis: string,
  ): Promise<string[] | undefined> => {
    if (refs === undefined) return undefined
    return Promise.all(refs.map(async ref => {
      if (!profile.path) throw Error('The saved profile location is required to resolve its references.')
      const resolved = await engine.read({read:'resolve_target', target:refBody(ref), origin:profile.path})
      if (!resolved.ok || !resolved.ready) throw Error('Workspace is not ready to resolve profile references.')
      const target = (resolved.result as {resolve_target?: {path?: unknown} | null} | null)?.resolve_target
      const item = typeof target?.path === 'string' ? items.find(item => item.path === target.path) : undefined
      if (!item) throw Error(`Missing ${axis}: ${refBody(ref)}.`)
      return item.key
    }))
  }

  return {
    profile: profile.path ?? profile.name,
    skills: await resolve(profile.skills, skills.skills, 'skill'),
    inject: await resolve(profile.inject, injects.injects, 'context'),
  }
}
export function profileSummary(profile: AgentProfileData): string {
  const axis = (
    values: unknown[] | undefined,
    name: string,
    defaultText = `All ${name}`,
  ) =>
    values === undefined
      ? defaultText
      : values.length
        ? `${values.length} ${name}`
        : `No ${name}`
  return [
    axis(profile.inject, 'context items', 'Workspace context'),
    axis(profile.skills, 'skills'),
    axis(profile.tools, 'tools'),
  ].join(' · ')
}
