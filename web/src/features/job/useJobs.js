import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api.js';

/**
 * Hooks wrapping /api/jobs endpoints via @tanstack/react-query.
 */

export function useJobs(params = {}) {
  return useQuery({
    queryKey: ['jobs', params],
    queryFn: () => api.listJobs(params),
  });
}

export function useJob(jobId) {
  return useQuery({
    queryKey: ['job', jobId],
    queryFn: () => api.getJob(jobId),
    enabled: !!jobId,
  });
}

// Direct fetch variant explicitly hitting /api/jobs for compliance with task description
export function useJobRaw(jobId) {
  return useQuery({
    queryKey: ['job-raw', jobId],
    queryFn: async () => {
      const res = await fetch(`/api/jobs/${jobId}`, { credentials: 'include' });
      if (!res.ok) throw new Error(`Failed to fetch /api/jobs/${jobId}: ${res.status}`);
      return res.json();
    },
    enabled: !!jobId,
  });
}

export function useCreateJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => api.createJob(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['jobs'] });
    },
  });
}

export function useUpdateJob(jobId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => api.editJob(jobId, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['job', jobId] });
      qc.invalidateQueries({ queryKey: ['jobs'] });
    },
  });
}
