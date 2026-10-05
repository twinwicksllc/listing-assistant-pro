export function createConditionPolicyCache<T>(
  load: (categoryId: string, sellerUserId: string) => Promise<T>,
): (categoryId: string, sellerUserId: string) => Promise<T> {
  const policies = new Map<string, Promise<T>>();
  return (categoryId, sellerUserId) => {
    const key = JSON.stringify([sellerUserId, categoryId]);
    let policy = policies.get(key);
    if (!policy) {
      policy = load(categoryId, sellerUserId);
      policies.set(key, policy);
    }
    return policy;
  };
}
