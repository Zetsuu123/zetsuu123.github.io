/* Phone Prices - the stores.
 *
 * search    URL of the store's search results page. {q} = query, URL-encoded (spaces as %20);
 *           {q+} = query with spaces as "+".
 * verified  true when the search URL is known to be right. For the others, if the page shows no
 *           products the extractor types the query into the store's own search box, and the app
 *           remembers the URL it lands on (see learnTemplate in app.js).
 * product   regular expression for the store's product-page links; each match is one product.
 * keyParam  query parameter that is part of a product's identity (otherwise only the path is).
 * attr      store-specific data-* attributes on product cards, read before the generic strategy.
 * phonePath regular expression for product URLs that are smartphones (a hint, not required).
 */
window.PP_STORES = [
  {
    id: 'skroutz',
    name: 'Skroutz',
    home: 'https://www.skroutz.gr/',
    search: 'https://www.skroutz.gr/search?keyphrase={q+}',
    verified: true,
    product: '^https://www\\.skroutz\\.gr/s/\\d+/',
    note: 'Lowest shop price listed on Skroutz',
    color: '#f08a24',
  },
  {
    id: 'public',
    name: 'Public',
    home: 'https://www.public.gr/',
    search: 'https://www.public.gr/search?text={q}',
    verified: false,
    product: '^https://www\\.public\\.gr/product/.+/\\d+(?:[/?#]|$)',
    phonePath: 'kinit|smartphone|tilefon',
    color: '#2f6fde',
  },
  {
    id: 'kotsovolos',
    name: 'Kotsovolos',
    home: 'https://www.kotsovolos.gr/',
    search: 'https://www.kotsovolos.gr/search?q={q}',
    verified: false,
    product: '^https://www\\.kotsovolos\\.gr/(?:[^/?#]+/){2,4}\\d+-[^/?#]+',
    phonePath: '/smartphones/|mobile-phones',
    color: '#1d9a6c',
  },
  {
    id: 'plaisio',
    name: 'Plaisio',
    home: 'https://www.plaisio.gr/',
    search: 'https://www.plaisio.gr/search?query={q}',
    verified: false,
    product: '^https://www\\.plaisio\\.gr/(?:[^/?#]+/)+[^/?#]+_\\d+(?:[/?#]|$)',
    phonePath: 'kinita|smartphone|tilefon',
    color: '#c6303e',
  },
  {
    id: 'germanos',
    name: 'Germanos',
    home: 'https://www.germanos.gr/',
    search: 'https://www.germanos.gr/search-results/?q={q}',
    verified: true,
    product: '^https://www\\.germanos\\.gr/product/.+[?&]productId=\\d+',
    keyParam: 'productId',
    attr: {
      sel: 'a[data-product-id][data-product-name]',
      card: '[class~="group/product"]',
      name: 'data-product-name',
      price: ['data-promo-price', 'data-price'],
      cat: 'data-product-category',
    },
    phonePath: 'smartphones',
    color: '#8a5cd6',
  },
];
