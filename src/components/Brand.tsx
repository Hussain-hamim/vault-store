import brand from "../../shared/brand.json";
import mark from "../assets/radefy-techmart-mark.png";
export function BrandMark({ className = "" }: { className?: string }) {
  return (
    <img
      className={"brand-mark " + className}
      src={mark}
      alt=""
      width={40}
      height={40}
      draggable={false}
    />
  );
}
export function BrandWordmark() {
  return (
    <>
      <BrandMark />
      <span className="brand-wordmark">
        <strong>
          {brand.name.split(" ")[0]} <em>{brand.shortName}</em>
        </strong>
        <small>{brand.company}</small>
      </span>
    </>
  );
}
