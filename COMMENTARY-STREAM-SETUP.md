# Lobi Stars FC Live: stream setup

How to get the partner's commentary stream playing on **lobistarsfc.com/commentary**
under the Lobi Stars FC Live name, so that fans only ever see a Lobi Stars address.

The website is ready for **either** option below. Pick one, then set the
values in the last section.

---

## Which option?

| | Option A: DNS (recommended) | Option B: relay through the website |
|---|---|---|
| What fans connect to | `https://stream.lobistarsfc.com/live` (the partner's server, under our name) | `https://lobistarsfc.com/live/commentary` (our website passes the audio through) |
| Bandwidth cost to us | None | Cloudflare doesn't charge per GB, but heavy audio traffic can breach Cloudflare's fair-use terms |
| Setup | One DNS record plus work on the partner's side | Only the partner's private stream address |
| Blocks listening outside match time | No (the player won't connect, but the address works) | Yes (the website refuses outside the commentary window) |
| Listener limit | Partner's server | Set on Admin → Commentary |
| Partner name in stream data | The partner must set the stream name to "Lobi Stars FC Live" | Replaced automatically |

**Recommendation:** use **Option A**. The site is on Cloudflare Pages (no server of our own),
and our DNS is already on Cloudflare, so Option A is one record and costs nothing.
Use Option B if the partner can't put our domain on their server, or as a stopgap.

**Bandwidth (Option B):** at 128 kbps each listener uses about **58–64 MB per
hour**. Example: 500 listeners for a 2-hour broadcast is about 60 GB, and 2,000
listeners is about 240 GB.

---

## Option A: DNS steps (plain English)

1. Ask the partner for **the address of their stream server** (a host name like
   `radio.partner-server.com`, or an IP address). They will also confirm the
   **mount point** (e.g. `/live` or `/lobistars`).
2. Log in to **Cloudflare** → choose **lobistarsfc.com** → **DNS** → **Records** → **Add record**:
   - **Type:** `CNAME` if they gave a host name (or `A` if they gave an IP address)
   - **Name:** `stream`
   - **Target / IPv4 address:** the address they gave you
   - **Proxy status:** click the orange cloud so it turns **grey ("DNS only")**.
     This is important: audio streams must not go through Cloudflare's proxy.
   - **Save.**
3. Tell the partner the record is in place, so they can issue the HTTPS
   certificate for `stream.lobistarsfc.com` (see the message below).
4. When they confirm, open `https://stream.lobistarsfc.com/<mount>` in a browser.
   You should hear audio, and the padlock should say the certificate is for stream.lobistarsfc.com.
5. On the website, go to **Admin → Commentary**, set **Public stream address** to
   `https://stream.lobistarsfc.com/<mount>`, **Save**, and press **Test stream**.

### Message to send to the partner

> Hello,
>
> For Lobi Stars FC home and away match commentary we're launching our own
> player on lobistarsfc.com, branded "Lobi Stars FC Live". Could you please set
> up the following on your streaming server:
>
> 1. **Custom domain:** accept connections for `stream.lobistarsfc.com`. We are
>    pointing this name at your server (please send us your server's host name or
>    IP address and we'll create the DNS record).
> 2. **HTTPS:** install a valid SSL certificate for `stream.lobistarsfc.com`
>    (e.g. Let's Encrypt). Our website only plays streams over HTTPS.
> 3. **A dedicated Lobi Stars feed / mount point**, e.g. `/live`, carrying only
>    Lobi Stars match commentary.
> 4. **Stream name / metadata:** set the stream name (icy-name / StreamTitle) to
>    **"Lobi Stars FC Live"**, the description to "Live match commentary from
>    Lobi Stars FC" and the URL to `https://lobistarsfc.com/commentary`. Please
>    don't include other station names or links in this feed's metadata.
> 5. **Format:** MP3 or AAC at 64–128 kbps (or HLS .m3u8 if that's what you use).
>    Please allow browser playback from lobistarsfc.com (CORS:
>    `Access-Control-Allow-Origin: https://lobistarsfc.com`).
> 6. Optionally, a **backup feed** (e.g. `stream2.lobistarsfc.com` or a second mount).
>
> Please let us know the mount point and when the certificate is in place so we
> can test.
>
> Thank you,
> Lobi Stars Football Club

---

## Option B: relay through the website

1. Get the partner's **private stream address** (e.g. `https://…/live`). This
   address is **never** shown to fans. It stays on the server.
2. In **Cloudflare** → **Workers & Pages** → the Lobi Stars project → **Settings** →
   **Variables and Secrets**, add a **Secret**:
   - `PARTNER_ORIGIN_STREAM_URL` = the partner's address
3. Redeploy (or wait for the next deploy).
4. On **Admin → Commentary**, leave **Public stream address** blank (it then uses
   `/live/commentary` automatically) or type `/live/commentary`. Set **Maximum
   listeners** (default 500). **Save**, then press **Test stream**.

What the relay does:
- passes the audio through as it arrives (nothing is stored);
- removes the partner's headers and stream titles and replaces them with "Lobi Stars FC Live";
- rewrites HLS (.m3u8) playlists so every segment also comes from lobistarsfc.com;
- refuses to play outside a match's commentary window;
- refuses new listeners above the maximum.

---

## Settings reference

| Setting | Where | Example |
|---|---|---|
| `COMMENTARY_STREAM_URL` | Cloudflare variable, or Admin → Commentary | `https://stream.lobistarsfc.com/live` |
| `COMMENTARY_BACKUP_STREAM_URL` | Cloudflare variable, or Admin → Commentary | `https://stream2.lobistarsfc.com/live` |
| `COMMENTARY_ENABLED` | Cloudflare variable, or Admin → Commentary | `on` / `off` |
| `COMMENTARY_BRAND_NAME` | Cloudflare variable | `Lobi Stars FC Live` |
| `COMMENTARY_MAX_LISTENERS` | Cloudflare variable, or Admin → Commentary | `500` |
| `PARTNER_ORIGIN_STREAM_URL` | **Cloudflare secret only** (Option B) | the partner's private address |

Public stream addresses must be on lobistarsfc.com. The website refuses any other address.
