# Avatar projection

`aup-avatar` mounts an interactive Three.js companion. `umbra` is the default.
The renderer also accepts `sphere`, `wizard`, `capybara`, `schnappa` and `heinrich`;
`AVATAR_CHOICES` in `src/avatars.ts` controls the choices exposed by the host picker.

The sphere and wizard use `RichAvatar`. The other characters use `CompanionStage`
with character-specific rigs. The projection uses `createAvatar`,
including renderer selection and resource disposal.

## Configure a pane

```yaml
character: umbra
size: 0.7
motion: 0.65
followCursor: true
```

The complete projection fields are declared in `type/aup-avatar.type.yaml`.
`src/avatar-config.ts` selects the renderer and `src/companion/config.ts` validates
companion settings. Sphere room visibility is controlled by `backdrop`.

The hover picker updates the character in place and persists configuration through
`host.saveConfig`. Switching disposes the previous renderer, listeners and GPU
resources. Host persistence follows the containing composition's save behavior.

## Interaction

The characters observe pointer movement and support docked and detached states.
Detached companions remain within the current application window. Return actions
and Escape bring them back to the pane. Explicit dragging temporarily takes over
from following; ordinary application pointer events pass through the overlay.

Umbra rests by ruminating. Other companion rigs can sleep. Reduced motion limits
automatic animation while preserving deliberate interaction. Exact movement,
attention and gesture behavior belongs to each renderer; these controls do not
introduce host routing or session-lifecycle behavior.

## Source map

| Responsibility | Source |
| --- | --- |
| Renderer selection | `src/avatars.ts`, `src/avatar-config.ts` |
| Host mounting and picker | `src/projection.ts`, `src/picker.ts` |
| Shared stage and rig contract | `src/companion/stage.ts`, `src/companion/rig.ts` |
| Attention, movement and gestures | `src/companion/behavior.ts`, `src/companion/navigation.ts`, `src/companion/gestures.ts` |
| Capybara and carpet geometry | `src/companion/capybara.ts`, `src/companion/carpet.ts` |
| Umbra | `src/umbra/rig.ts` |
| Sphere renderer | `src/rich-avatar.ts`, `src/sphere-presentation.ts` |
| Resource disposal | `src/three-resources.ts` |

## Checks

```sh
pnpm --filter @arsumbris/au-avatar test
pnpm --filter @arsumbris/au-avatar typecheck
pnpm --filter @arsumbris/au-avatar build
```

Inspect character switching, dock/detach/return, dragging, reduced motion and
narrow-pane fitting in the Host application.
