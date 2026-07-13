import { redirect } from "next/navigation";

// "Saved" became "Collections" — keep the old path working.
export default function SavedPage() {
  redirect("/collections");
}
