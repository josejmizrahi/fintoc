import { useQueryStates, parseAsString, parseAsInteger } from 'nuqs';

export function usePaymentFilters() {
  return useQueryStates({
    status: parseAsString.withDefault(''),
    search: parseAsString.withDefault(''),
    page: parseAsInteger.withDefault(1),
    per_page: parseAsInteger.withDefault(20),
    date_from: parseAsString.withDefault(''),
    date_to: parseAsString.withDefault(''),
  });
}

export function useInvoiceFilters() {
  return useQueryStates({
    type: parseAsString.withDefault(''),
    status: parseAsString.withDefault(''),
    search: parseAsString.withDefault(''),
    page: parseAsInteger.withDefault(1),
    per_page: parseAsInteger.withDefault(20),
    date_from: parseAsString.withDefault(''),
    date_to: parseAsString.withDefault(''),
  });
}

export function useVendorFilters() {
  return useQueryStates({
    search: parseAsString.withDefault(''),
    page: parseAsInteger.withDefault(1),
    per_page: parseAsInteger.withDefault(20),
  });
}

export function useCustomerFilters() {
  return useQueryStates({
    search: parseAsString.withDefault(''),
    page: parseAsInteger.withDefault(1),
    per_page: parseAsInteger.withDefault(20),
  });
}

export function useExpenseFilters() {
  return useQueryStates({
    status: parseAsString.withDefault(''),
    search: parseAsString.withDefault(''),
    page: parseAsInteger.withDefault(1),
    per_page: parseAsInteger.withDefault(20),
    date_from: parseAsString.withDefault(''),
    date_to: parseAsString.withDefault(''),
  });
}

export function useTreasuryFilters() {
  return useQueryStates({
    type: parseAsString.withDefault(''),
    page: parseAsInteger.withDefault(1),
    per_page: parseAsInteger.withDefault(20),
    date_from: parseAsString.withDefault(''),
    date_to: parseAsString.withDefault(''),
  });
}

export function useAuditFilters() {
  return useQueryStates({
    action: parseAsString.withDefault(''),
    entity_type: parseAsString.withDefault(''),
    user_id: parseAsString.withDefault(''),
    page: parseAsInteger.withDefault(1),
    per_page: parseAsInteger.withDefault(50),
    date_from: parseAsString.withDefault(''),
    date_to: parseAsString.withDefault(''),
  });
}
