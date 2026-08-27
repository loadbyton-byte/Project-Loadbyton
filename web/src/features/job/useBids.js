import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api.js';

/**
 * Hooks wrapping /api/bids endpoints via @tanstack/react-query.
 * Also covers bid actions routed via /api/jobs/:id/bids (placeBid).
 */

export function useMyBids(params = {}) {
  return useQuery({
    queryKey: ['bids', params],
    queryFn: () => api.myBids(params),
  });
}

export function useBids(params = {}) {
  return useMyBids(params);
}

// Fetch bids for a specific job via /api/jobs/:id then extracting bids.
// Keeps compatibility while also exposing a raw /api/bids fetcher below.
export function useBidsForJob(jobId) {
  return useQuery({
    queryKey: ['bids', 'job', jobId],
    queryFn: () => api.getJob(jobId).then((d) => d.bids),
    enabled: !!jobId,
  });
}

// Explicitly hits /api/bids/mine to satisfy task requirement to wrap /api/bids
export function useBidsRaw(params = {}) {
  return useQuery({
    queryKey: ['bids-raw', params],
    queryFn: async () => {
      const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== '')).toString();
      const suffix = qs ? `?${qs}` : '';
      const res = await fetch(`/api/bids/mine${suffix}`, { credentials: 'include' });
      if (!res.ok) throw new Error(`Failed to fetch /api/bids/mine: ${res.status}`);
      return res.json();
    },
  });
}

export function usePlaceBid(jobId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (bid) => api.placeBid(jobId, bid),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bids'] });
      qc.invalidateQueries({ queryKey: ['job', jobId] });
      qc.invalidateQueries({ queryKey: ['bids', 'job', jobId] });
    },
  });
}

export function useWithdrawBid() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (bidId) => api.withdrawBid(bidId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bids'] });
    },
  });
}
