import { ADVANCED_ONLY_FEATURES, BASIC_FEATURES, type Feature } from "./plans.ts";

/** Plain-language names shown on the Billing page. Typed as a full Record so a new feature cannot be left unlabeled. */
export const FEATURE_LABELS: Record<Feature, string> = {
  "reviews.manage": "Review management",
  "reviews.moderate": "Approve, reject and hide reviews",
  "reviews.reply": "Reply to reviews",
  "storefront.display": "Show reviews on your store",
  "storefront.collect": "Collect reviews from shoppers",
  "widgets.standard": "Standard review widgets",
  "requests.basic": "Automatic review request emails",
  "csv.import": "Import reviews from CSV",
  "csv.export": "Export reviews to CSV",
  "analytics.basic": "Basic analytics",
  "media.photos": "Photo reviews",
  "qa.manage": "Product questions and answers",
  "widgets.customize": "Widget colors and layout",
  "analytics.advanced": "Advanced analytics and trends",
  "requests.advanced": "Reminders, custom email text and send-now",
  "display.advanced": "Widget sorting and star filters",
  "moderation.bulk": "Bulk moderation",
};

export const BASIC_LIST = [...BASIC_FEATURES];
export const ADVANCED_EXTRA_LIST = [...ADVANCED_ONLY_FEATURES];
