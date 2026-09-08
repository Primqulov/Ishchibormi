"use client";

import type { QueryClient } from "@tanstack/react-query";
import { api, type APIError, type Application, type Elon, getAccess, type User } from "./api";

export type MyElons = { drafts?: Elon[]; active: Elon[]; archived: Elon[] };
export type OwnerListingGuard = { listing: Elon; user: User; applications: Application[] };

/** The grouped endpoint paginates all of an employer's applications, not each listing. */
export async function loadAllOwnerApplications(signal?: AbortSignal): Promise<Record<string, Application[]>> {
  const session = getAccess();
  if (!session) throw { code: "no_account", message: "Hisobingizga qayta kiring." } satisfies APIError;
  const applications = new Map<string, Application>();
  const limit = 500;
  const incomplete = () => ({
    code: "applications_incomplete",
    message: "Arizalar ro'yxatini to'liq yuklab bo'lmadi. Qayta urinib ko'ring.",
  } satisfies APIError);
  function checkSession() {
    if (getAccess() !== session) {
      throw { code: "owner_required", message: "Hisobingiz o'zgardi. Sahifani yangilang." } satisfies APIError;
    }
    signal?.throwIfAborted();
  }
  for (let page = 1; ; page += 1) {
    checkSession();
    const result = await api.get<Record<string, Application[]>>(
      `/api/my/elons/applications?limit=${limit}&page=${page}`,
      { cache: "no-store", signal },
    );
    checkSession();
    if (!result || typeof result !== "object" || Array.isArray(result)) throw incomplete();
    let pageCount = 0;
    let added = 0;
    for (const [elonId, items] of Object.entries(result)) {
      if (!Array.isArray(items)) throw incomplete();
      for (const application of items) {
        if (!application || typeof application.id !== "string" || !application.id || application.elonId !== elonId) throw incomplete();
        pageCount += 1;
        if (!applications.has(application.id)) {
          applications.set(application.id, application);
          added += 1;
        }
      }
    }
    // A server ignoring `page` must fail visibly instead of looping forever or
    // returning a misleading partial count. The API caps pages at 10,000.
    if (pageCount > limit || (pageCount === limit && (added === 0 || page >= 10_000))) throw incomplete();
    if (pageCount < limit) {
      const grouped: Record<string, Application[]> = Object.create(null);
      for (const application of applications.values()) (grouped[application.elonId] ??= []).push(application);
      return grouped;
    }
  }
}

export function isOwnerEditable(listing: Elon): boolean {
  return !listing.isDeleted && ["draft", "recruiting", "filled"].includes(listing.status);
}

export function isOwnerClosable(listing: Elon): boolean {
  return !listing.isDeleted && ["draft", "recruiting", "filled", "confirmed", "in_progress"].includes(listing.status);
}

export function requiresOwnerCancellation(listing: Elon, applications: Application[] = []): boolean {
  return listing.acceptedCount > 0 || ["filled", "confirmed", "in_progress"].includes(listing.status)
    || applications.some((application) => application.status === "accepted");
}

/** Fresh server checks are shared by every owner mutation entry point. */
export async function loadOwnerListingGuard(id: string): Promise<OwnerListingGuard> {
  const session = getAccess();
  if (!session) throw { code: "no_account", message: "Hisobingizga qayta kiring." } satisfies APIError;
  const [user, listing, grouped] = await Promise.all([
    api.get<User>("/api/me"),
    api.get<Elon>(`/api/elons/${encodeURIComponent(id)}`, { cache: "no-store" }),
    loadAllOwnerApplications(),
  ]);
  if (getAccess() !== session || !user?.id || listing?.ownerId !== user.id) {
    throw { code: "owner_required", message: "Bu amalni faqat e'lon egasi bajarishi mumkin." } satisfies APIError;
  }
  if (listing.id !== id || listing.isDeleted) {
    throw { code: "listing_unavailable", message: "Bu e'lon bilan amal bajarib bo'lmaydi." } satisfies APIError;
  }
  return { listing, user, applications: grouped?.[id] || [] };
}

const listingQueryKeys = new Set([
  "elon", "my-elons", "my-elons-applications", "my-applications", "feed", "feed-latest",
  "history", "notifications", "owner-listing", "owner-edit",
]);

export async function invalidateOwnerListingQueries(client: QueryClient, _id: string): Promise<void> {
  const predicate = (query: { queryKey: readonly unknown[] }) => listingQueryKeys.has(String(query.queryKey[0]));
  // Discard responses started before the mutation so they cannot restore old cards.
  await client.cancelQueries({ predicate });
  await client.invalidateQueries({ predicate });
}

export function ownerListingError(error: unknown): string {
  const value = error as Partial<APIError> | undefined;
  return value?.message || "Amalni bajarib bo'lmadi. Qayta urinib ko'ring.";
}
