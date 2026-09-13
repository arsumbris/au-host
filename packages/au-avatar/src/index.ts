// Package surface: the standalone `<au-avatar-sphere>` custom element and its renderer.
// Importing this module registers the element (guarded), so a consumer — the launcher, a
// projection, anything — can just import the package and use the tag.

import { defineAuAvatarSphere } from './element'

export { AuAvatarSphereElement, defineAuAvatarSphere } from './element'
export { SphereRenderer } from './sphere-gl'
export type { SphereOptions } from './sphere-gl'
export { CompanionStage } from './companion/stage'
export { DEFAULT_CONFIG, PRESETS, parseConfig } from './companion/config'
export type { CompanionConfig } from './companion/config'
export type { Emotion, Gesture } from './companion/capybara'
export { AVATAR_CHOICES, AVATAR_STYLE, createAvatar } from './avatars'
export { parseAvatarPreset } from './avatar-config'
export type { AvatarKind, AvatarPreset } from './avatar-config'

defineAuAvatarSphere()

export type { CompanionRig, RigFactory } from './companion/rig'
export { createCapybaraRig } from './companion/rig'

export { Schnappa } from './companion/schnappa'

export { Heinrich } from './companion/heinrich'
