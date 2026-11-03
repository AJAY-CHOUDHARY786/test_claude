/** Builds schema.org JSON-LD only when real, published review data supports it. */
export interface StructuredReview { author: string; rating: number; body: string; datePublished: Date }

export function buildProductJsonLd(input: {
  productName: string; reviewCount: number; averageRating: number; reviews: StructuredReview[];
}): string | null {
  const { productName, reviewCount, averageRating } = input;
  if (!productName.trim() || !Number.isInteger(reviewCount) || reviewCount < 1) return null;
  if (!Number.isFinite(averageRating) || averageRating < 1 || averageRating > 5) return null;
  const data = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: productName,
    aggregateRating: {
      "@type": "AggregateRating",
      ratingValue: Math.round(averageRating * 10) / 10,
      reviewCount,
      bestRating: 5,
      worstRating: 1,
    },
    review: input.reviews.slice(0, 5).map((r) => ({
      "@type": "Review",
      author: { "@type": "Person", name: r.author },
      reviewRating: { "@type": "Rating", ratingValue: r.rating, bestRating: 5, worstRating: 1 },
      reviewBody: r.body,
      datePublished: r.datePublished.toISOString().slice(0, 10),
    })),
  };
  // Escape characters that could close the script tag or break out of it.
  return JSON.stringify(data).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}
