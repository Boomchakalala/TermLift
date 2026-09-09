/**
 * TermLift design system — six objects. If a screen needs a seventh, question it.
 *
 *   Btn          one button; one `primary` per view
 *   Chip         severity / category / mode
 *   DealStatus   the deal stage badge (+ secondary line)
 *   StatTile     the KPI tile (+ StatRow)
 *   ScoreRing    the only score visual
 *   StageRail    the product ladder
 *   GateCard     every unlock / paywall / waiting-on-you moment
 *
 * plus layout helpers: PageHeader/PageBody, Table/TableRow, SectionHeading/Card, ImageSlot.
 */
export { Btn } from './Btn'
export { Chip, type ChipTone } from './Chip'
export { StatTile, StatRow } from './StatTile'
export { ScoreRing, scoreColor, scoreTextClass } from './ScoreRing'
export { StageRail } from './StageRail'
export { DealStatus } from './DealStatus'
export { GateCard } from './GateCard'
export { PageHeader, PageBody, AppPage, BackLink, type Crumb } from './PageHeader'
export { Table, TableHead, TableRow, HideM, NameCell } from './DataTable'
export { SectionHeading, Card } from './SectionHeading'
export { ImageSlot } from './ImageSlot'
