import prisma from "../db.server";

export type DriverInput = {
  name: string;
  photoUrl?: string | null;
  phoneNumber?: string | null;
  email?: string | null;
  vehicleName?: string | null;
  vehicleRegistration?: string | null;
  vehicleType?: string | null;
  fuelCardNumber?: string | null;
  fuelCardProvider?: string | null;
  startAddress?: string | null;
  endAddress?: string | null;
  isActive?: boolean;
  notes?: string | null;
};

function driverData(input: DriverInput) {
  return {
    name: input.name,
    photoUrl: input.photoUrl || null,
    phoneNumber: input.phoneNumber || null,
    email: input.email || null,
    vehicleName: input.vehicleName || null,
    vehicleRegistration: input.vehicleRegistration || null,
    vehicleType: input.vehicleType || null,
    fuelCardNumber: input.fuelCardNumber || null,
    fuelCardProvider: input.fuelCardProvider || null,
    startAddress: input.startAddress || null,
    endAddress: input.endAddress || null,
    isActive: input.isActive ?? true,
    notes: input.notes || null,
  };
}

export async function listDrivers() {
  return prisma.driver.findMany({
    orderBy: [
      { isActive: "desc" },
      { name: "asc" },
    ],
  });
}

export async function listActiveDrivers() {
  const drivers = await prisma.driver.findMany({
    where: {
      isActive: true,
    },
    select: {
      id: true,
      name: true,
      isActive: true,
    },
    orderBy: {
      name: "asc",
    },
  });

  return drivers.map((driver) => ({
    ...driver,
    photoUrl: null,
    phoneNumber: null,
    email: null,
    vehicleName: null,
    vehicleRegistration: null,
    vehicleType: null,
    fuelCardNumber: null,
    fuelCardProvider: null,
    startAddress: null,
    endAddress: null,
    notes: null,
    createdAt: null,
    updatedAt: null,
  }));
}

export async function createDriver(input: DriverInput) {
  return prisma.driver.create({
    data: driverData(input),
  });
}

export async function updateDriver(driverId: string, input: DriverInput) {
  return prisma.driver.update({
    where: {
      id: driverId,
    },
    data: driverData(input),
  });
}

export async function deleteDriver(driverId: string) {
  await prisma.route.updateMany({
    where: {
      driverId,
    },
    data: {
      driverId: null,
    },
  });

  return prisma.driver.delete({
    where: {
      id: driverId,
    },
  });
}
