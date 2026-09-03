import rateLimit from 'express-rate-limit';

/**
 * Standard rate limiter for all general API endpoints.
 * 100 requests per 15 minutes.
 */
export const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many requests, please try again later.',
  },
});

/**
 * Stricter rate limiter for deployment triggers.
 * 5 deploy triggers per minute per client.
 */
export const deployLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many deployment requests. Maximum 5 triggers per minute.',
  },
});
