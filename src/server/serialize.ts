// Wandelt Prisma-Datensaetze in einfache, JSON-sichere Objekte fuer
// Sockets und Clients um (Dates -> ISO-Strings).

import { DRIVER_STATUS_LABEL } from "../lib/status";
import { parseStops } from "../lib/stops";
import { vehicleClass as vehicleClassInfo } from "../lib/vehicleClasses";
import { medicalLabel, mobilityLabel, equipmentLabels, documentValidity } from "../lib/medical";
import { meetGreetLabel } from "../lib/airportExtras";
import { resolveAirportPickup } from "../lib/airportZones";

export function iso(d: Date | null | undefined): string | null {
  return d ? new Date(d).toISOString() : null;
}

// Oeffentliche Fahrerinfo fuer den Kunden (ohne sensible Daten).
export function driverPublic(driver: any) {
  if (!driver) return null;
  return {
    id: driver.id,
    name: driver.name,
    phone: driver.phone ?? null,
    vehicleModel: driver.vehicleModel ?? null,
    vehiclePlate: driver.vehiclePlate ?? null,
    vehicleColor: driver.vehicleColor ?? null,
    vehicleClass: driver.vehicleClass ?? "STANDARD",
    vehicleClassLabel: vehicleClassInfo(driver.vehicleClass).label,
    vehicleClassIcon: vehicleClassInfo(driver.vehicleClass).icon,
    lat: driver.lat ?? null,
    lng: driver.lng ?? null,
  };
}

// Fahrerinfo fuer die Admin-Live-Karte.
export function driverAdmin(driver: any) {
  return {
    id: driver.id,
    name: driver.name,
    phone: driver.phone ?? null,
    username: driver.username,
    status: driver.status,
    statusLabel: DRIVER_STATUS_LABEL[driver.status] ?? driver.status,
    lat: driver.lat ?? null,
    lng: driver.lng ?? null,
    vehicleModel: driver.vehicleModel ?? null,
    vehiclePlate: driver.vehiclePlate ?? null,
    vehicleColor: driver.vehicleColor ?? null,
    vehicleSeats: driver.vehicleSeats ?? 4,
    vehicleClass: driver.vehicleClass ?? "STANDARD",
    vehicleClassLabel: vehicleClassInfo(driver.vehicleClass).label,
    medicalAllowed: driver.medicalAllowed ?? false,
    hasRamp: driver.hasRamp ?? false,
    hasStretcher: driver.hasStretcher ?? false,
    pScheinUntil: driver.pScheinUntil ?? null,
    pSchein: documentValidity(driver.pScheinUntil),
    wheelchairTrained: driver.wheelchairTrained ?? false,
    qualifications: driver.qualifications ?? null,
    lastSeenAt: iso(driver.lastSeenAt),
  };
}

// Krankenfahrt-Details (Phase B) – gemeinsam fuer Booking- und Serien-DTO.
function medicalDetailsDTO(x: any) {
  return {
    patientName: x.patientName ?? null,
    patientBirthDate: x.patientBirthDate ?? null,
    mobility: x.mobility ?? null,
    mobilityLabel: mobilityLabel(x.mobility),
    companions: x.companions ?? 0,
    medicalEquipment: x.medicalEquipment ? String(x.medicalEquipment).split(",").filter(Boolean) : [],
    medicalEquipmentLabels: equipmentLabels(x.medicalEquipment),
    payerType: x.payerType ?? null,
    insuranceName: x.insuranceName ?? null,
    insuranceNumber: x.insuranceNumber ?? null,
    requiresRamp: x.requiresRamp ?? false,
    requiresStretcher: x.requiresStretcher ?? false,
    institutionId: x.institutionId ?? null,
  };
}

// Gruppen-/Eventbuchung (Phase 13): Eltern-Datensatz inkl. Kind-Fahrten.
export function groupDTO(g: any, children: any[] = []) {
  return {
    id: g.id,
    customerName: g.customerName,
    customerPhone: g.customerPhone,
    pickupAddress: g.pickupAddress,
    pickupLat: g.pickupLat,
    pickupLng: g.pickupLng,
    destAddress: g.destAddress,
    destLat: g.destLat,
    destLng: g.destLng,
    isScheduled: g.isScheduled,
    scheduledAt: iso(g.scheduledAt),
    vehicleCount: g.vehicleCount,
    totalPassengers: g.totalPassengers,
    totalLuggage: g.totalLuggage,
    eventLabel: g.eventLabel ?? null,
    notes: g.notes ?? null,
    paymentMethod: g.paymentMethod ?? "CASH",
    createdAt: iso(g.createdAt),
    bookings: children.map((b) => bookingDTO(b)),
  };
}

// Wiederkehrende (Kranken-)Fahrt (Phase 15) inkl. anstehender Buchungen.
export function recurringDTO(r: any, opts: { upcoming?: any[] } = {}) {
  const weekdays = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
  const dayList = (r.daysOfWeek ?? "")
    .split(",")
    .map((s: string) => parseInt(s.trim(), 10))
    .filter((n: number) => n >= 0 && n <= 6)
    .map((n: number) => weekdays[n]);
  return {
    id: r.id,
    customerName: r.customerName,
    customerPhone: r.customerPhone,
    pickupAddress: r.pickupAddress,
    destAddress: r.destAddress,
    vehicleClass: r.vehicleClass,
    vehicleClassLabel: vehicleClassInfo(r.vehicleClass).label,
    medicalType: r.medicalType ?? null,
    medicalLabel: medicalLabel(r.medicalType),
    ...medicalDetailsDTO(r),
    daysOfWeek: r.daysOfWeek,
    dayLabels: dayList,
    timeOfDay: r.timeOfDay,
    returnTrip: r.returnTrip ?? false,
    returnTimeOfDay: r.returnTimeOfDay ?? null,
    startDate: iso(r.startDate),
    endDate: iso(r.endDate),
    active: r.active,
    notes: r.notes ?? null,
    createdAt: iso(r.createdAt),
    upcoming: (opts.upcoming ?? []).map((b) => bookingDTO(b)),
  };
}

// Chat-Nachricht (Phase 3i).
export function messageDTO(m: any) {
  return {
    id: m.id,
    bookingId: m.bookingId,
    sender: m.sender, // CUSTOMER | DRIVER
    text: m.text,
    createdAt: iso(m.createdAt),
  };
}

// Vollstaendiges Buchungs-DTO.
export function bookingDTO(b: any, extra: Record<string, any> = {}) {
  return {
    id: b.id,
    // Tracking-Token für Gast-Links (fällt für Alt-Buchungen ohne Token auf die ID zurück).
    trackingRef: b.trackingToken ?? b.id,
    trackingToken: b.trackingToken ?? null,
    groupId: b.groupId ?? null,
    recurringId: b.recurringId ?? null,
    medicalType: b.medicalType ?? null,
    medicalLabel: medicalLabel(b.medicalType),
    ...medicalDetailsDTO(b),
    returnAt: iso(b.returnAt),
    customerName: b.customerName,
    customerPhone: b.customerPhone,
    pickupAddress: b.pickupAddress,
    pickupLat: b.pickupLat,
    pickupLng: b.pickupLng,
    destAddress: b.destAddress,
    destLat: b.destLat,
    destLng: b.destLng,
    stops: parseStops(b.stops),
    passengers: b.passengers,
    luggage: b.luggage,
    childSeat: b.childSeat,
    vehicleClass: b.vehicleClass ?? "STANDARD",
    vehicleClassLabel: vehicleClassInfo(b.vehicleClass).label,
    vehicleClassIcon: vehicleClassInfo(b.vehicleClass).icon,
    notes: b.notes ?? null,
    isScheduled: b.isScheduled,
    scheduledAt: iso(b.scheduledAt),
    flightNumber: b.flightNumber ?? null,
    flightDirection: b.flightDirection ?? null,
    terminal: b.terminal ?? null,
    flightStatus: b.flightStatus ?? null,
    flightScheduledAt: iso(b.flightScheduledAt),
    flightDelayMinutes: b.flightDelayMinutes ?? 0,
    meetGreet: b.meetGreet ?? null,
    meetGreetLabel: meetGreetLabel(b.meetGreet),
    pickupZone: resolveAirportPickup(b.pickupAddress, b.terminal),
    hotelId: b.hotelId ?? null,
    roomNumber: b.roomNumber ?? null,
    hotelPayment: b.hotelPayment ?? null,
    isVip: b.isVip ?? false,
    promoCode: b.promoCode ?? null,
    promoDiscount: b.promoDiscount ?? null,
    meetGreetFee: b.meetGreetFee ?? null,
    waitMinutes: b.waitMinutes ?? null,
    waitFee: b.waitFee ?? null,
    distanceMeters: b.distanceMeters ?? null,
    durationSeconds: b.durationSeconds ?? null,
    priceMin: b.priceMin ?? null,
    priceMax: b.priceMax ?? null,
    priceApprox: b.priceApprox ?? null,
    priceExact: b.priceExact ?? null,
    priceAuthorized: b.priceAuthorized ?? null,
    platformFeeRate: b.platformFeeRate ?? null,
    platformFee: b.platformFee ?? null,
    companyNet: b.companyNet ?? null,
    tariff: b.tariff ?? null,
    fare: b.fare ?? null,
    rating: b.rating ?? null,
    ratingComment: b.ratingComment ?? null,
    paymentMethod: b.paymentMethod ?? "CASH",
    paymentStatus: b.paymentStatus ?? "OFFEN",
    priceIsFixed: b.priceIsFixed ?? false,
    corporateCode: b.corporateCode ?? null,
    corporatePayer: b.corporatePayer ?? null,
    status: b.status,
    trackingStatus: b.trackingStatus,
    driverId: b.driverId ?? null,
    driver: b.driver ? driverPublic(b.driver) : null,
    isReserved: b.isReserved ?? false,
    isSos: b.isSos ?? false,
    destChangedAt: iso(b.destChangedAt),
    destChangeCount: b.destChangeCount ?? 0,
    cancelledAt: iso(b.cancelledAt),
    cancelledBy: b.cancelledBy ?? null,
    cancelReason: b.cancelReason ?? null,
    assignedAt: iso(b.assignedAt),
    acceptedAt: iso(b.acceptedAt),
    arrivedAt: iso(b.arrivedAt),
    startedAt: iso(b.startedAt),
    completedAt: iso(b.completedAt),
    createdAt: iso(b.createdAt),
    hasSignature: !!b.signature,
    signatureAt: iso(b.signature?.signedAt),
    ...extra,
  };
}
