# Loadbyton search growth

## Implemented
Route-specific titles and descriptions, canonical URLs, social previews, linked Organization/WebSite/WebPage entities, prerendered public pages, a freight services and quotation guide, and sitemap/robots generation for both build targets. Account and unknown routes receive noindex through host headers and client metadata. No invented reviews, addresses, rates or guaranteed capacity have been added.

## Keyword map
| Page | Search intent and relevant phrases |
| --- | --- |
| Home | UAE freight marketplace, UAE road freight, container transport UAE |
| Services | container drayage, Jebel Ali container transport, Khalifa Port transport requirements, full truckload UAE, flatbed transport, lowbed transport, refrigerated freight quotations |
| For shippers | book truck UAE, freight quotation UAE, compare transporter bids |
| For transporters | UAE truck loads, freight jobs UAE, fleet owner freight platform |
| Industries | construction material transport, trading company freight, retail road freight |
| Features | freight booking platform, shipment tracking, proof of delivery, freight documents |

These are relevant topic targets, not verified search-volume or trending-keyword claims. Do not add unrelated trends, hidden keyword lists, fabricated ratings, or duplicate emirate doorway pages. Confirm live service availability before expanding claims.

## Launch and measurement
1. Deploy the reviewed branch using the existing host build command.
2. Verify the production domain in Google Search Console using DNS or the configured VITE_GSC_VERIFICATION token. No verification credential is supplied in this repository.
3. Submit https://loadbyton.com/sitemap.xml. Inspect home, services and both audience pages; confirm Google sees the rendered copy, self-canonical URLs and successful responses.
4. Check actual production responses for /login, /dashboard and an unknown URL. Account routes must return noindex; unknown URLs should eventually return a genuine 404 from the host rather than the current SPA fallback.
5. Use Search Console impressions, clicks and queries to prioritize content. Track completed registrations and genuine load postings alongside traffic. Compare 28-day periods after a stable deployment; do not equate impressions with sales.
6. Use Keyword Planner and available trend data to validate UAE demand. Prioritize qualified quotation intent over unrelated high-volume terms. No authenticated keyword-volume data was available during this implementation.
7. Publish original operations evidence: completed-job case studies with permission, real route constraints, transparent platform fees and equipment guidance reviewed by an operator. Add substantive route pages only when they contain distinct, verified information.
8. Add accurate contact details and business listings only when approved facts are available. Do not invent a physical office or claim Google Business Profile eligibility.
9. Audit mobile Core Web Vitals in production. Compress heavy hero media based on measured results. Static markup is present, but the SPA still replaces it on mount; hydration/performance improvement is a separate engineering task.
10. For Arabic discovery, publish complete Arabic URLs and translations before adding hreflang. The existing locale toggle is not a substitute for indexable translated pages.

## AI search
Google's AI search guidance uses foundational SEO: useful, accessible content and accurate entities. There is no guaranteed AI placement, special GEO schema or required llms.txt. FAQ copy is visible to readers; commercial FAQs are not claimed to qualify for Google's restricted FAQ rich results.

References:
- https://developers.google.com/search/docs/fundamentals/ai-optimization-guide
- https://developers.google.com/search/docs/essentials/spam-policies

## Outstanding
Search Console ownership, live deployment verification, real query/volume data, production speed measurements, Arabic editorial review and independent reputation building require access or real business evidence. Neither indexing nor rankings are guaranteed.
