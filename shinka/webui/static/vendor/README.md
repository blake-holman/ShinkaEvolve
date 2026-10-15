# Vendored browser libraries

Pinned builds served by the dashboard from `/static/vendor/`. The browser never
contacts a CDN, so the dashboard works on machines without internet access and
a library release cannot change behaviour silently.

| File | Package | Version | Source |
|------|---------|---------|--------|
| chart-3.9.1.min.js | chart.js | 3.9.1 | https://cdn.jsdelivr.net/npm/chart.js@3.9.1/dist/chart.min.js |
| chart-4.5.1.umd.min.js | chart.js | 4.5.1 | https://cdn.jsdelivr.net/npm/chart.js@4.5.1/dist/chart.umd.min.js |
| d3-7.9.0.min.js | d3 | 7.9.0 | https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js |
| marked-15.0.12.min.js | marked | 15.0.12 | https://cdn.jsdelivr.net/npm/marked@15.0.12/marked.min.js |
| html2pdf-0.10.1.bundle.min.js | html2pdf.js | 0.10.1 | https://cdn.jsdelivr.net/npm/html2pdf.js@0.10.1/dist/html2pdf.bundle.min.js |
| jspdf-2.5.1.umd.min.js | jspdf | 2.5.1 | https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js |
| highlight-11.8.0.min.js | highlight.js | 11.8.0 | https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@11.8.0/highlight.min.js |
| highlight-11.8.0-python.min.js | highlight.js (python) | 11.8.0 | https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@11.8.0/languages/python.min.js |
| highlight-11.8.0-github.min.css | highlight.js (github theme) | 11.8.0 | https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@11.8.0/styles/github.min.css |
| diff-5.1.0.min.js | diff | 5.1.0 | https://cdn.jsdelivr.net/npm/diff@5.1.0/dist/diff.min.js |
| plotly-1.58.5.min.js | plotly.js-dist-min | 1.58.5 | https://cdn.jsdelivr.net/npm/plotly.js-dist-min@1.58.5/plotly.min.js |
| jszip-3.10.1.min.js | jszip | 3.10.1 | https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js |

The tree page previously loaded `plotly-latest.min.js`, which Plotly froze at
1.58.5 in 2021; the same version is pinned here so chart behaviour is
unchanged. The compare page loaded an unpinned `chart.js`, which resolved to
4.5.1 at the time of vendoring. Upgrading Plotly is a separate change.

Licenses are in `licenses/`. SHA-256 checksums:

```
fbc45926e6b46845a0f905552a0e0b1331049bff1115ecf94dbe0904d895e710 chart-3.9.1.min.js
48444a82d4edcb5bec0f1965faacdde18d9c17db3063d042abada2f705c9f54a chart-4.5.1.umd.min.js
f2094bbf6141b359722c4fe454eb6c4b0f0e42cc10cc7af921fc158fceb86539 d3-7.9.0.min.js
3a29bd9374b219bd6964550085cddf6b62fc4073893d3f251c1d61ef1ea56b7f diff-5.1.0.min.js
4499ff936d4fd562adca5a5cbe512dc19eb80942eee8618dafbcebc4f7974bdb highlight-11.8.0.min.js
a9e944fc74986429887456b0714004afcd6a849ab52a7f766001ed98e2bf33cc highlight-11.8.0-python.min.js
85e6ee9ce246e3ae4424313f7e46a5ed860a28d757811de8dc9c43f306049d65 html2pdf-0.10.1.bundle.min.js
98ccf17aa10c20bb1301762618fcc9b6ab3a4e7f26b6071d64d0b41154df3875 jspdf-2.5.1.umd.min.js
acc7e41455a80765b5fd9c7ee1b8078a6d160bbbca455aeae854de65c947d59e jszip-3.10.1.min.js
3e7e7d7feb3e5d58cb6c804f68ab5c24cc7e5eb6270fd6e5cbb9124739217d0c marked-15.0.12.min.js
7085d5a3331da1f63d752ddbfbcae92f46134b3296d46aa6364c5f13b87ff27c plotly-1.58.5.min.js
3a9a5def8b9c311e5ae43abde85c63133185eed4f0d9f67fea4b00a8308cf066 highlight-11.8.0-github.min.css
```
