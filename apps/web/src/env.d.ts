declare global {
  namespace NodeJS {
    interface ProcessEnv {
      readonly INTERNAL_API_SECRET?: string;
      readonly NEXT_PUBLIC_TURNSTILE_SITE_KEY?: string;
      readonly WORKER_API_URL?: string;
    }
  }
}

export {};
