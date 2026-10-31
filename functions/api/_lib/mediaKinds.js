// Media Centre: each kind of content and how it is checked, previewed,
// published and unpublished. Added phase by phase.
//   normalise(data) -> { value } | { error }   cleans what the editor sent
//   validate(data)  -> null | 'problem'        complete enough to submit / approve?
//   titleOf(data)   -> the title shown in lists
//   previewHtml(data) -> HTML for the Approval Queue preview (escaped)
//   publish(env, item, data, ctx) -> { ok, slug?, note? } | { error }
//   unpublish(env, item) -> { ok } | { error }
//   schedulable: true when it can be approved for a later date and time
export const KINDS = {};
export function registerKind(id, def) { KINDS[id] = def; }
