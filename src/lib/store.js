"use client";

import { create } from "zustand";

export const sortOptions = [
  { value: "biggestDrop", label: "Biggest Gap" },
  { value: "biggestSavings", label: "Biggest AED Gap" },
  { value: "newest", label: "Newest Scan" },
];

export const useDashboardStore = create((set) => ({
  propertyType: "all",
  onlyTenPercentDrops: false,
  onlyExpatAreas: false,
  pricePeriod: "yearly",
  sortBy: "newest",
  activeArea: null,
  setPropertyType: (propertyType) => set({ propertyType }),
  toggleTenPercentDrops: () =>
    set((state) => ({ onlyTenPercentDrops: !state.onlyTenPercentDrops })),
  toggleExpatAreas: () =>
    set((state) => ({ onlyExpatAreas: !state.onlyExpatAreas })),
  setPricePeriod: (pricePeriod) => set({ pricePeriod }),
  setSortBy: (sortBy) => set({ sortBy }),
  setActiveArea: (activeArea) => set({ activeArea }),
  clearActiveArea: () => set({ activeArea: null }),
}));
