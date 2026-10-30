// The fictional people created by `npm run demo:seed`. Everything here is made up: the names are common
// Indian names, the emails end in @facetrack.test (a reserved example domain), and every account gets the
// shared demo password from db/demo_passwords.sql. The department is part of the SRN (CS, EC, IT, ME, EE, CE)
// because the students table has no department column.
export const DEMO_PASSWORD = "FaceTrack@123";

export interface DemoStudent {
  first: string; last: string; gender: "M" | "F"; dept: string; year: string; no: number;
  parent: { first: string; last: string; relation: "father" | "mother" | "guardian"; emailKey?: string };
}

// 14 students. Isha and Pranav Bhatt are siblings who share one parent login (a parent with two wards).
export const DEMO_STUDENTS: DemoStudent[] = [
  { first: "Aarav", last: "Sharma", gender: "M", dept: "CS", year: "22", no: 104, parent: { first: "Rajesh", last: "Sharma", relation: "father" } },
  { first: "Vihaan", last: "Reddy", gender: "M", dept: "EC", year: "22", no: 117, parent: { first: "Suresh", last: "Reddy", relation: "father" } },
  { first: "Arjun", last: "Nair", gender: "M", dept: "IT", year: "23", no: 109, parent: { first: "Lalitha", last: "Nair", relation: "mother" } },
  { first: "Rohan", last: "Mehta", gender: "M", dept: "ME", year: "22", no: 131, parent: { first: "Kiran", last: "Mehta", relation: "father" } },
  { first: "Karan", last: "Iyer", gender: "M", dept: "CS", year: "23", no: 142, parent: { first: "Gayathri", last: "Iyer", relation: "mother" } },
  { first: "Siddharth", last: "Menon", gender: "M", dept: "EE", year: "21", no: 118, parent: { first: "Mohan", last: "Menon", relation: "father" } },
  { first: "Aditya", last: "Rao", gender: "M", dept: "CE", year: "23", no: 126, parent: { first: "Venkat", last: "Rao", relation: "father" } },
  { first: "Pranav", last: "Bhatt", gender: "M", dept: "IT", year: "22", no: 151, parent: { first: "Anjali", last: "Bhatt", relation: "mother", emailKey: "bhatt" } },
  { first: "Ananya", last: "Krishnan", gender: "F", dept: "CS", year: "22", no: 123, parent: { first: "Radha", last: "Krishnan", relation: "mother" } },
  { first: "Diya", last: "Venkatesh", gender: "F", dept: "EC", year: "23", no: 135, parent: { first: "Balaji", last: "Venkatesh", relation: "father" } },
  { first: "Meera", last: "Pillai", gender: "F", dept: "IT", year: "22", no: 112, parent: { first: "Sudha", last: "Pillai", relation: "mother" } },
  { first: "Isha", last: "Bhatt", gender: "F", dept: "ME", year: "21", no: 147, parent: { first: "Anjali", last: "Bhatt", relation: "mother", emailKey: "bhatt" } },
  { first: "Kavya", last: "Subramanian", gender: "F", dept: "EE", year: "23", no: 158, parent: { first: "Ramesh", last: "Subramanian", relation: "father" } },
  { first: "Riya", last: "Kulkarni", gender: "F", dept: "CE", year: "22", no: 164, parent: { first: "Smita", last: "Kulkarni", relation: "mother" } },
];

export const studentEmail = (s: DemoStudent) => `${s.first}.${s.last}@facetrack.test`.toLowerCase();
export const parentEmail = (s: DemoStudent) => `parent.${s.parent.emailKey ?? s.first}@facetrack.test`.toLowerCase();
export const srn = (s: DemoStudent) => `${s.year}${s.dept}${s.no}`;
export const parentPhone = (i: number) => `+91984500${String(1000 + i * 37).slice(-4)}`.slice(0, 13);

// The student to register LIVE in front of the teacher. Nothing the seeder creates uses this SRN, these
// emails or any room on the first floor (x-1nn) of a hostel, so they are all free.
export const LIVE_STUDENT = {
  name: "Harish Rameshkumar", srn: "24CS901", roomNumber: "120",
  email: "harish.demo@facetrack.test", parentName: "Rameshkumar", parentEmail: "parent.harish@facetrack.test", parentPhone: "+919845000901", relation: "father",
};
