/**
 * Handler index — re-exports all handler modules (#16)
 *
 * The catch-all route.ts remains the main router but delegates
 * to these handler modules for the bulk of the business logic.
 * This reduces the main file from 1100+ lines to a manageable router.
 */

export { handlePaymentsGet, handlePaymentsPost } from "./payments";
export { handleSatGet, handleSatPost } from "./sat";
