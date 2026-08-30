export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
  requestId: string;
}

export interface ApiErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
  };
  requestId: string;
}

export type ApiResponse<T> =
  | ApiSuccessResponse<T>
  | ApiErrorResponse;