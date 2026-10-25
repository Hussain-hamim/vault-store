import { useEffect, useRef, useState } from "react";
import { CameraIcon, ArrowClockwiseIcon } from "@phosphor-icons/react";
import { api } from "../api";
import { useI18n } from "../i18n";
import { prepareProductPhoto } from "../product-photo-upload";
import {
  isStoredPhoto,
  normalizeImageBrand,
  normalizeImageText,
  productPhotoSelection,
} from "../../server/product-images.mjs";
import { ProductPhoto, PhotoProduct } from "./ProductPhoto";
import "./product-photos.css";
export type PhotoValue = { image: string; photo_data?: string };
export function ProductPhotoPicker({
  product,
  existingImage,
  initialUpload,
  compact = false,
  onChange,
  onBusy,
}: {
  product: PhotoProduct;
  existingImage?: string;
  initialUpload?: string;
  compact?: boolean;
  onChange: (value: PhotoValue) => void;
  onBusy: (value: boolean) => void;
}) {
  const { t } = useI18n();
  const identity = [
    product.category,
    normalizeImageBrand(product.brand),
    normalizeImageText(product.model),
    product.attributes?.Type || "",
  ].join("|");
  const original = useRef(existingImage);
  const [uploaded, setUploaded] = useState<{
      identity: string;
      src: string;
    } | null>(initialUpload ? { identity, src: initialUpload } : null),
    [saved, setSaved] = useState<{ identity: string; src: string } | null>(
      null,
    ),
    // Reopened drafts/records retain their saved automatic selection instead of
    // silently learning a different custom photo for the same model.
    [automatic, setAutomatic] = useState(
      Boolean(existingImage && !isStoredPhoto(existingImage)),
    ),
    [error, setError] = useState(""),
    [reading, setReading] = useState(false),
    [searching, setSearching] = useState(false);
  const originalPhoto = isStoredPhoto(original.current) ? original.current : "";
  // A manual upload belongs to this form, even while product details change.
  const upload = uploaded?.src || "";
  const useAuto = automatic;
  const savedRef = !useAuto
    ? upload
      ? ""
      : originalPhoto || (saved?.identity === identity ? saved.src : "")
    : "";
  const selection = productPhotoSelection({
    ...product,
    image: savedRef || undefined,
  });
  const image = selection.src;
  useEffect(() => {
    onChange(
      upload && !useAuto ? { image: "", photo_data: upload } : { image },
    );
  }, [upload, useAuto, image, onChange]);
  useEffect(() => {
    onBusy(reading || searching);
  }, [reading, searching, onBusy]);
  useEffect(() => {
    let active = true;
    if (
      !product.brand?.trim() ||
      !product.model?.trim() ||
      useAuto ||
      upload ||
      originalPhoto
    ) {
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = setTimeout(
      () =>
        api<{ image: string | null }>("productPhotoMatch", {
          brand: product.brand,
          model: product.model,
          category: product.category,
        })
          .then((result) => {
            if (active) setSaved({ identity, src: result.image || "" });
          })
          .catch(() => {
            /* Offline built-in catalog remains available if a lookup fails. */
          })
          .finally(() => {
            if (active) setSearching(false);
          }),
      180,
    );
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [identity, useAuto, upload, originalPhoto]);
  async function pick(file: File | null) {
    if (!file) return;
    setError("");
    setReading(true);
    try {
      const src = await prepareProductPhoto(file);
      setUploaded({ identity, src });
      setAutomatic(false);
    } catch (e: any) {
      setError(
        t(e.message?.startsWith("photos.") ? e.message : "photos.unreadable"),
      );
    } finally {
      setReading(false);
    }
  }
  const custom = !!savedRef || (!!upload && !useAuto);
  const label = custom
    ? t("photos.custom")
    : selection.photo
      ? t(selection.kind === "exact" ? "photos.exact" : "photos.reference", {
          model: selection.photo.brand + " " + selection.photo.model,
        })
      : t("photos.missing");
  return (
    <div className={"product-photo-picker" + (compact ? " compact" : "")}>
      <div className="product-form-preview">
        <ProductPhoto
          product={{ ...product, image: savedRef || undefined }}
          preview={!useAuto ? upload : undefined}
          eager
        />
        <div className="photo-picker-copy">
          <strong>{t("photos.title")}</strong>
          <small>{label}</small>
          <p>
            {t(
              custom
                ? "photos.savedHint"
                : selection.kind === "reference"
                  ? "photos.referenceHint"
                  : selection.kind === "missing"
                    ? "photos.missingHint"
                    : "photos.exactHint",
            )}
          </p>
        </div>
        <div className="photo-picker-actions">
          <label className="button">
            <CameraIcon size={16} />
            {t(reading ? "photos.reading" : "photos.choose")}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={reading}
              onChange={(e) => {
                pick(e.target.files?.[0] || null);
                e.target.value = "";
              }}
            />
          </label>
          {custom && (
            <button
              className="text-button"
              type="button"
              onClick={() => {
                setUploaded(null);
                setAutomatic(true);
                setError("");
              }}
            >
              <ArrowClockwiseIcon size={14} />
              {t("photos.useAutomatic")}
            </button>
          )}
        </div>
      </div>
      {error && (
        <p className="photo-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
