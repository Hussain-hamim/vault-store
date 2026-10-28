import { useEffect, useRef, useState } from "react";
import {
  CameraIcon,
  ArrowClockwiseIcon,
  ImageIcon,
} from "@phosphor-icons/react";
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
import { Modal, ErrorMessage } from "./ui";
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
    [searching, setSearching] = useState(false),
    [cameraOpen, setCameraOpen] = useState(false);
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
    : selection.kind === "category" && selection.photo
      ? product.category === "Accessories" && product.attributes?.Type
        ? t("photos.accessory", { type: product.attributes.Type })
        : t("photos.category", { category: product.category || "" })
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
                : selection.kind === "category"
                  ? "photos.categoryHint"
                  : selection.kind === "reference"
                    ? "photos.referenceHint"
                    : selection.kind === "missing"
                      ? "photos.missingHint"
                      : "photos.exactHint",
            )}
          </p>
        </div>
        <div className="photo-picker-actions">
          <label className="button" tabIndex={compact ? -1 : undefined}>
            <ImageIcon size={16} />
            {t(reading ? "photos.reading" : "photos.choose")}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={reading}
              tabIndex={compact ? -1 : undefined}
              onChange={(e) => {
                pick(e.target.files?.[0] || null);
                e.target.value = "";
              }}
            />
          </label>
          <button
            type="button"
            className="button"
            disabled={reading}
            tabIndex={compact ? -1 : undefined}
            onClick={() => {
              setError("");
              setCameraOpen(true);
            }}
          >
            <CameraIcon size={16} />
            {t("photos.camera")}
          </button>
          {custom && (
            <button
              className="text-button"
              type="button"
              tabIndex={compact ? -1 : undefined}
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
      {cameraOpen && (
        <CameraCapture
          onClose={() => setCameraOpen(false)}
          onCapture={async (file) => {
            setCameraOpen(false);
            await pick(file);
          }}
        />
      )}
    </div>
  );
}

function CameraCapture({
  onClose,
  onCapture,
}: {
  onClose: () => void;
  onCapture: (file: File) => void | Promise<void>;
}) {
  const { t } = useI18n();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError(t("photos.cameraUnsupported"));
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        });
        if (!active) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play();
          if (active) setReady(true);
        }
      } catch {
        if (active) setError(t("photos.cameraDenied"));
      }
    }
    void start();
    return () => {
      active = false;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, [t]);
  async function snap() {
    const video = videoRef.current;
    if (!video || !ready || busy) return;
    setBusy(true);
    setError("");
    try {
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 480;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("photos.unreadable");
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", 0.92),
      );
      if (!blob) throw new Error("photos.unreadable");
      await onCapture(
        new File([blob], `product-${Date.now()}.jpg`, { type: "image/jpeg" }),
      );
    } catch (e: any) {
      setError(
        t(e.message?.startsWith("photos.") ? e.message : "photos.unreadable"),
      );
      setBusy(false);
    }
  }
  return (
    <Modal title={t("photos.camera")} onClose={onClose}>
      <div className="form-body product-camera-body">
        <div className="product-camera-frame">
          <video ref={videoRef} playsInline muted autoPlay />
        </div>
        <ErrorMessage error={error} />
        <p className="muted">{t("photos.cameraHint")}</p>
      </div>
      <div className="modal-actions">
        <button type="button" className="button" onClick={onClose}>
          {t("common.cancel")}
        </button>
        <button
          type="button"
          className="button button-dark"
          disabled={!ready || busy || !!error}
          onClick={() => void snap()}
        >
          <CameraIcon size={16} />
          {busy ? t("photos.reading") : t("photos.capture")}
        </button>
      </div>
    </Modal>
  );
}
