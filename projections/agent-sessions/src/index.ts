import {
  defineProjection,
  type ProjectionModule,
  type MountFn,
} from '@arsumbris/au-host-sdk'
import { mountLauncher } from './launcher'
import { mountRuntimeSettings } from './runtime-settings'
import { mountProfiles } from './profiles'

export default defineProjection<
  ProjectionModule & { profiles: MountFn; runtimes: MountFn; history: MountFn }
>({
  mount: mountLauncher,
  history: (container, host) => mountLauncher(container, host, true),
  profiles: mountProfiles,
  runtimes: mountRuntimeSettings,
})
