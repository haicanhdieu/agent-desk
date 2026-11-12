import { ProblemSchema } from '../problem';

export interface FieldError {
  pointer: string;
  detail: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly type: string;
  readonly title: string;
  readonly detail?: string;
  readonly errors?: FieldError[];
  readonly requestId?: string;

  constructor(init: {
    status: number;
    type: string;
    title: string;
    detail?: string;
    errors?: FieldError[];
    requestId?: string;
  }) {
    super(init.detail ?? init.title);
    this.name = 'ApiError';
    this.status = init.status;
    this.type = init.type;
    this.title = init.title;
    if (init.detail !== undefined) this.detail = init.detail;
    if (init.errors !== undefined) this.errors = init.errors;
    if (init.requestId !== undefined) this.requestId = init.requestId;
  }
}

/** Builds an ApiError from a failed response; tolerates non-problem bodies. */
export async function apiErrorFromResponse(res: Response): Promise<ApiError> {
  const headerId = res.headers.get('x-request-id') ?? undefined;
  let raw: unknown;
  try {
    raw = await res.json();
  } catch {
    raw = undefined;
  }
  const problem = ProblemSchema.safeParse(raw);
  if (problem.success) {
    const p = problem.data;
    const requestId = headerId ?? p.requestId;
    return new ApiError({
      status: res.status,
      type: p.type,
      title: p.title,
      ...(p.detail !== undefined && { detail: p.detail }),
      ...(p.errors !== undefined && { errors: p.errors }),
      ...(requestId !== undefined && { requestId }),
    });
  }
  return new ApiError({
    status: res.status,
    type: 'about:blank',
    title: res.statusText || `HTTP ${res.status}`,
    ...(headerId !== undefined && { requestId: headerId }),
  });
}
