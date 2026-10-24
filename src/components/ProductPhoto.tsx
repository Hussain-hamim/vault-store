import { useEffect, useRef, useState } from "react";
import {
  DesktopTowerIcon,
  DeviceMobileIcon,
  DeviceTabletIcon,
  HardDriveIcon,
  PackageIcon,
} from "@phosphor-icons/react";
import { api } from "../api";
import {
  productPhotoSelection,
  isStoredPhoto,
} from "../../server/product-images.mjs";
import { useI18n } from "../i18n";
export type PhotoProduct = {
  name?: string;
  brand?: string;
  model?: string;
  category?: string;
  image?: string;
  attributes?: Record<string, string>;
};
const icons: Record<string, typeof PackageIcon> = {
  Computers: DesktopTowerIcon,
  Mobiles: DeviceMobileIcon,
  Tablets: DeviceTabletIcon,
  Storage: HardDriveIcon,
};
// Bounded, in-flight-deduplicated cache. Blobs are fetched only when a thumbnail is near view.
const cache = new Map<string, Promise<string>>();
const clear = () => cache.clear();
window.addEventListener("vault-session-expired", clear);
window.addEventListener("radefy-photos-reset", clear);
function photoUrl(ref: string) {
  let promise = cache.get(ref);
  if (!promise) {
    promise = api<{ src: string }>("productPhoto", { ref })
      .then((data) => data.src)
      .catch((error) => {
        cache.delete(ref);
        throw error;
      });
    cache.set(ref, promise);
    if (cache.size > 64) cache.delete(cache.keys().next().value!);
  }
  return promise;
}
export function ProductPhoto({
  product,
  className = "",
  alt = "",
  eager = false,
  preview,
}: {
  product: PhotoProduct;
  className?: string;
  alt?: string;
  eager?: boolean;
  preview?: string;
}) {
  const { t } = useI18n();
  const selected = productPhotoSelection(product),
    ref = preview || selected.src;
  const [loaded, setLoaded] = useState<{ ref: string; src: string } | null>(
      null,
    ),
    [failed, setFailed] = useState("");
  const holder = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!isStoredPhoto(ref)) return;
    let active = true,
      started = false;
    const load = () => {
      if (started) return;
      started = true;
      photoUrl(ref)
        .then((src) => {
          if (active) {
            setLoaded({ ref, src });
            setFailed("");
          }
        })
        .catch(() => {
          if (active) setFailed(ref);
        });
    };
    if (eager) load();
    const observer =
      !eager && typeof IntersectionObserver !== "undefined"
        ? new IntersectionObserver(
            (entries) => {
              if (entries.some((e) => e.isIntersecting)) {
                load();
                observer?.disconnect();
              }
            },
            { rootMargin: "100px" },
          )
        : null;
    if (observer && holder.current) observer.observe(holder.current);
    else load();
    return () => {
      active = false;
      observer?.disconnect();
    };
  }, [ref, eager]);
  const src = isStoredPhoto(ref)
    ? loaded && loaded.ref === ref
      ? loaded.src
      : ""
    : ref;
  const Icon = icons[product.category || ""] || PackageIcon;
  const title =
    preview || selected.kind === "custom"
      ? t("photos.custom")
      : selected.photo
        ? t(selected.kind === "exact" ? "photos.exact" : "photos.reference", {
            model: selected.photo.brand + " " + selected.photo.model,
          })
        : t("photos.missing");
  const url = src.startsWith("/")
    ? new URL(src.slice(1), document.baseURI).href
    : src;
  return (
    <span
      ref={holder}
      className={"product-photo " + className}
      title={title}
      data-photo-kind={preview ? "custom" : selected.kind}
    >
      {src && failed !== ref ? (
        <img
          src={url}
          alt={alt}
          loading={eager ? "eager" : "lazy"}
          decoding="async"
          onError={() => setFailed(ref)}
        />
      ) : (
        <Icon size={26} weight="duotone" aria-label={alt || title} />
      )}
    </span>
  );
}
