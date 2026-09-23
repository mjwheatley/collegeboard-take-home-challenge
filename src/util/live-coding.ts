/**
 *
 * NOTE: PLEASE USE PREFERRED LANGUAGE
 *
 * Part 1: Most Frequent Secure Tag
 *
 * You are given an array of ExamItem objects.
 *
 * Implement the function `mostFrequentSecureTag`.
 *
 * Rules:
 * - Only consider items where:
 *     - securityLevel === "secure" OR
 *     - securityLevel === "highly-secure"
 * - Count every occurrence of every tag across those items.
 * - Return the tag that appears the most total times.
 * - If there is a tie, you may return any one of them.
 * - If there are no secure items, or no tags on secure items,
 *   return null.
 *
 * Example:
 *
 * const items = [
 *   {
 *     id: "1",
 *     securityLevel: "secure",
 *     metadata: { tags: ["algebra", "functions"] },
 *   },
 *   {
 *     id: "2",
 *     securityLevel: "highly-secure",
 *     metadata: { tags: ["algebra"] },
 *   },
 *   {
 *     id: "3",
 *     securityLevel: "standard",
 *     metadata: { tags: ["algebra"] },
 *   },
 * ];
 *
 * mostFrequentSecureTag(items); // "algebra"
 */

/**
 * Minimal ExamItem shape needed for this exercise.
 */
export interface ExamItem {
  id: string;
  metadata: {
    tags: string[];
  };
  securityLevel: string; // "standard" | "secure" | "highly-secure"
}

export function mostFrequentSecureTag(
  items: ExamItem[]
): string | null {
  const secureItems = items.filter((item) => ['secure', 'highly-secure'].includes(item.securityLevel));

  if (!secureItems?.length) return null;

  const secureItemsHaveTags = secureItems.some((item) =>  item.metadata.tags.length);

  if (!secureItemsHaveTags) return null;

  const tagFrequency = new Map<string, number>();

  for (let item of secureItems) {
    const {tags} = item.metadata;
    for (let tag of tags) {
      if (!tagFrequency[tag]) {
        tagFrequency[tag] = 0;
      }
      tagFrequency[tag] += 1;
    }
  }
  // Find the tag with the highest count and return the name of that tag.

  return null;
}