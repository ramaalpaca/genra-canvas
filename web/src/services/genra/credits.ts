// User credits balance for the top bar: same wallet the editor shows (`users.credits`, GET /api/v1/user/subscription/status).
// The OpenAI facade bills this wallet too (responses carry `genra.credits_cost` / `genra.credits_balance`).
import { useQuery } from "@tanstack/react-query";
import axios from "axios";

import { getGenraAccessToken, useGenraAuth } from "./auth";
import { GENRA_API_URL, GENRA_FRONTEND_URL } from "./env";

export type SubscriptionStatus = {
    total_credits: number;
    subscription_credits?: number;
    addon_credits?: number;
    is_paid?: boolean;
};

export const GENRA_PRICING_URL = `${GENRA_FRONTEND_URL}/pricing`;

export async function fetchSubscriptionStatus(accessToken: string) {
    const response = await axios.get<SubscriptionStatus>(`${GENRA_API_URL}/api/v1/user/subscription/status`, { headers: { Authorization: `Bearer ${accessToken}` } });
    return response.data;
}

export function useCreditsBalance() {
    const userId = useGenraAuth((state) => state.user?.id);
    return useQuery({
        queryKey: ["genra", "credits", userId],
        queryFn: () => fetchSubscriptionStatus(getGenraAccessToken()),
        enabled: Boolean(userId),
        staleTime: 10_000,
        refetchInterval: 30_000,
        refetchOnWindowFocus: true,
    });
}
