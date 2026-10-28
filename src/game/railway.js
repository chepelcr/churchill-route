// Browser-free validation for the embedded runtime's completion contract.
export function railwayResult(value) {
  if(!value || !Number.isFinite(value.elapsed) || value.elapsed<=0 || value.elapsed>86400
    || !Number.isInteger(value.stars) || value.stars<0 || value.stars>3
    || !Number.isFinite(value.topSpeed) || value.topSpeed<0 || value.topSpeed>600)return null;
  return {elapsed:value.elapsed,stars:value.stars,topSpeed:value.topSpeed};
}
