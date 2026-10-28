# pawtato

One good dog at a time. A single-page site that shows a random dog from the
[Dog CEO API](https://dog.ceo/dog-api/), lets you save the ones you love, give them a
name, and share a photo or a link that opens the exact same dog.

Everything is static except two small Netlify pieces: a function that proxies the photo
and an edge function that renders the link preview.

## Structure

```
.
├── index.html                        # the whole site: HTML, CSS, vanilla JS
├── netlify.toml                      # publish dir, functions dir, edge route
└── netlify
    ├── functions
    │   └── dog-image.js              # streams a Dog CEO photo back as binary
    └── edge-functions
        └── dog-og.js                 # injects per-dog Open Graph tags into "/"
```

## How sharing works

- Every dog has a URL: `/?dog=<encoded image>&name=<name>&breed=<breed>`.
- The Share button fetches the photo through `/.netlify/functions/dog-image`, turns it
  into a `File` and hands it to the native share sheet when
  `navigator.canShare({ files: [file] })` allows it. Otherwise it shares the link.
- Opening a shared link shows that exact dog with its name and breed and does not fetch a
  random one.

## Link previews

`netlify/edge-functions/dog-og.js` runs on `/`. For a request with valid `dog`, `name` and
`breed` parameters it takes `index.html` from `context.next()`, strips the existing
Open Graph / Twitter tags, and injects tags built from those parameters (`og:image` points
at the dog's photo). Anything that is not a valid dog share is returned untouched.

## Image function

`netlify/functions/dog-image.js` accepts only `https://images.dog.ceo/breeds/...` JPEG,
PNG or WebP files: no redirects, an 8 second timeout, a streaming 6 MB cap, and proper
status codes (400/404/413/415/502/504). No dependencies.

## Local development

```sh
netlify dev        # serves the site, the function and the edge function
```

Opening `index.html` from disk works for browsing dogs, but sharing needs the function,
so use `netlify dev` (or the deployed site) for that.
