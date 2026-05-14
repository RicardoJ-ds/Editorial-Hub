import { apiGet } from "@/lib/api";
import type { DeliverableMonthly } from "@/lib/types";

const PAGE = 1000;

/** Fetch every deliverable row from the backend, paging through in batches
 *  of 1000 until the API returns a short page. Guarantees complete history
 *  regardless of client count or engagement length. */
export async function fetchAllDeliverables(): Promise<DeliverableMonthly[]> {
  const all: DeliverableMonthly[] = [];
  let skip = 0;
  while (true) {
    const page = await apiGet<DeliverableMonthly[]>(
      `/api/deliverables/?limit=${PAGE}&skip=${skip}`,
    );
    all.push(...page);
    if (page.length < PAGE) break;
    skip += PAGE;
  }
  return all;
}
