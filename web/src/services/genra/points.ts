// Genra points balance (GET /api/v1/generate/points-balance) for the top bar.
import { useQuery } from "@tanstack/react-query";
import axios from "axios";

import { getGenraAccessToken, useGenraAuth } from "./auth";
import { GENRA_API_URL, GENRA_FRONTEND_URL } from "./env";

export type PointsBalance = { points_balance: number; org_id: string };

export const GENRA_PRICING_URL = `${GENRA_FRONTEND_URL}/pricing`;

export async function fetchPointsBalance(accessToken: string) {
    const response = await axios.get<PointsBalance>(`${GENRA_API_URL}/api/v1/generate/points-balance`, { headers: { Authorization: `Bearer ${accessToken}` } });
    return response.data;
}

export function usePointsBalance() {
    const userId = useGenraAuth((state) => state.user?.id);
    return useQuery({
        queryKey: ["genra", "points-balance", userId],
        queryFn: () => fetchPointsBalance(getGenraAccessToken()),
        enabled: Boolean(userId),
        staleTime: 10_000,
        refetchInterval: 30_000,
        refetchOnWindowFocus: true,
    });
}
