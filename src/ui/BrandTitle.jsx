import React from "react";
import identity from "../../brand/identity.json";

const officialTitle = identity.titleLines.join(" ");

export default function BrandTitle({ className = "", title = officialTitle, stacked = true }) {
  return <h1 className={`brand-title ${className}`}>
    {stacked && title === officialTitle ? identity.titleLines.map((line, index) =>
      <span key={line} className="brand-title__line">{index > 0 && " "}{line}</span>
    ) : title}
  </h1>;
}
