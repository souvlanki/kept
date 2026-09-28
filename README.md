# Kept

A free, self-hosted archive of the second-hand pieces you like. It has two parts:

- **`site/`** is the archive website: an iTunes-style Cover Flow. GitHub Pages hosts it for free.
- **`extension/`** is a Chrome extension. When you like, save or watch a listing, it saves the listing into the website's repository within a few seconds.

## What happens when you like something

1. The extension notices the click on the heart / Like / Watch / Save button (on the listing page or on a card in search results).
2. It asks the Wayback Machine to save the listing page.
3. It reads the listing: title, price, brand, size, condition, colour, seller, location, the description, and any "item specifics" table.
4. It takes a full-page screenshot.
5. It downloads every photo at full size and stores copies in your repository, so the photos survive even when the listing is deleted.
6. It commits all of that in one commit. GitHub Pages republishes, and the piece appears on your site about a minute later.
7. It keeps checking the Wayback Machine until the snapshot finishes (usually 1 to 5 minutes), then updates the item's link to that exact snapshot.

On the site, **Open archived listing** always points to the Wayback Machine copy, never the original URL. Before the snapshot finishes, it points to the most recent snapshot of that URL.

## Setup (about 10 minutes)

### 1. Put the website on GitHub Pages

1. Create a free account at github.com if you don't have one.
2. Create a new **public** repository, for example `kept`. (GitHub Pages is free for public repositories. Your archive will be viewable by anyone with the link.)
3. Upload everything inside `site/` to the root of the repository, including the hidden `.nojekyll` file and the `data/` folder. The easiest way is "Add file", then "Upload files", and drag the contents of the `site` folder in.
4. Open the repository's Settings, then Pages. Under "Build and deployment", pick "Deploy from a branch", branch `main`, folder `/ (root)`, and save.
5. After a minute, your site is live at `https://YOUR-USERNAME.github.io/kept/`. It shows sample pieces until your first like arrives. Add `?demo` to the address at any time to see the samples.

### 2. Create an access token for the extension

1. On GitHub, open Settings, then Developer settings, then Personal access tokens, then **Fine-grained tokens**, then "Generate new token".
2. Repository access: **Only select repositories**, and pick `kept`.
3. Permissions: Repository permissions, **Contents: Read and write**. Nothing else.
4. Pick an expiry (the longest is a year; set a reminder to renew it) and generate. Copy the token.

### 3. Install the extension

1. Open `chrome://extensions` (this also works in Edge, Brave and Arc).
2. Turn on **Developer mode** (top right), click **Load unpacked**, and choose the `extension` folder.
3. The settings page opens. Fill in your GitHub username, the repository name, and the token. Click **Test connection**.
4. Optional but recommended: sign in at archive.org, visit `archive.org/account/s3.php`, and paste the two keys into the Wayback Machine section. Captures are more reliable and are linked to the exact snapshot.

### 4. Like something

Like a listing on Depop or add one to your eBay watchlist. A small note appears in the corner of the page ("Saving to Kept…", then "Kept, with 6 photos and a full-page capture").

Other ways to save a listing, on any website:
- the Kept toolbar button, then **Save this page**
- right-click a listing link, then **Save this listing to Kept**
- **Alt+Shift+K**

## Using the archive

- **Browse:** drag or swipe the covers, scroll with a trackpad or mouse wheel over them, use the left and right arrow keys, click a side cover, or drag the bar underneath.
- **Photos:** when a piece reaches the centre, its photos drop down underneath it. Click one to show it on the cover; click it again (or click the cover) to open the viewer. The up and down arrow keys step through the photos.
- **Full page:** the last tile shows the full-page capture of the listing as it looked when you liked it.
- **Search and filter:** by site, or by any word in the title, brand, size, seller, colour or description.
- **Share a piece:** each piece has its own link (the address bar updates as you browse).

## Good to know

- **Sites supported for automatic saving:** Depop, eBay (.com, .co.uk, .com.au, .com.sg and other main domains), Vinted, Grailed, Vestiaire Collective, Poshmark, Mercari, Etsy, Carousell and The RealReal. Every other site works through the toolbar button, right-click menu or shortcut.
- **Likes in the phone apps aren't seen.** The extension only sees likes you make in desktop Chrome. For something you liked on your phone, open your likes page on desktop and right-click each listing, then **Save this listing to Kept**.
- **Unliking doesn't remove a piece.** The archive is meant to outlast the listing. To remove one, delete its entry from `data/index.json` and its folder under `data/items/` in the repository.
- **"Kept started debugging this browser".** Chrome shows this bar for a second during each full-page screenshot. That's how Chrome lets extensions capture the whole page rather than only what's on screen. It closes itself.
- **Likes from search results** open the listing in a background tab for a few seconds, capture it, and close it.
- **Sites change their pages.** Reading listings relies first on the structured product data that Depop, eBay and most shops publish for search engines, which rarely changes. If a site redesigns and a field stops coming through, the matching code is in `extension/scraper.js` (reading) and `extension/content.js` (spotting the like button).
- **The Wayback Machine sometimes can't save a page** (rate limits, or a site blocking it). The site then says so, and the full-page capture and photos in your repository are still there.
- **Space:** each piece takes roughly 1 to 3 MB. GitHub is comfortable with about 1 GB per repository, so a few hundred pieces is fine.
