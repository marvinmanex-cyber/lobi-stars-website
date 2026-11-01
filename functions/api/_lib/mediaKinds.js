// Media Centre: each kind of content and how it is checked, previewed,
// published and unpublished.
//   normalise(data, ctx) -> { value } | { error }   (may be async) cleans what the editor sent
//   validate(data)  -> null | 'problem'        complete enough to submit / approve?
//   titleOf(data)   -> the title shown in lists
//   previewHtml(data) -> HTML for the Approval Queue preview (escaped / sanitised)
//   publish(env, item, data, ctx) -> { ok, slug?, note? } | { error }
//   unpublish(env, item) -> { ok } | { error }
//   schedulable: true when it can be approved for a later date and time
//   adminFields: the fields offered by "Edit, then approve"
//   scheduleFor(env, item): the kind's own publishing time (or null = now)
//   noCorrections: published items can't be changed (e.g. a newsletter already emailed)
//   mediaCreate: false when media staff can't create it as an item (live updates come from the Matchday Desk)
import { NEWS } from './mediaNews.js';
import { NEWSLETTER } from './mediaNewsletter.js';
import { PRESS } from './mediaPress.js';
import { ALBUM } from './mediaLibrary.js';
import { LINEUP, LIVE } from './mediaMatchday.js';

export const KINDS = { news: NEWS, newsletter: NEWSLETTER, press: PRESS, album: ALBUM, lineup: LINEUP, live: LIVE };
export function registerKind(id, def) { KINDS[id] = def; }
