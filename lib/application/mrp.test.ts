import {calculateMaterialRequirement} from './mrp';
const cases=[
 [{physicalOnHand:0,safetyStock:10000},{netReplenishmentRequirement:10000,projectedBalanceAfterReplenishment:10000}],
 [{physicalOnHand:4000,safetyStock:10000},{netReplenishmentRequirement:6000,projectedBalanceAfterReplenishment:10000}],
 [{physicalOnHand:12000,safetyStock:10000},{netReplenishmentRequirement:0,projectedBalanceAfterReplenishment:12000}],
 [{physicalOnHand:10000,reserved:3000,eligibleIncoming:2000,safetyStock:10000},{availableBeforeReplenishment:7000,projectedBalanceBeforeReplenishment:9000,netReplenishmentRequirement:1000,projectedBalanceAfterReplenishment:10000}],
] as const;
for(const [input,expected] of cases){const actual=calculateMaterialRequirement(input);for(const [key,value] of Object.entries(expected))if(actual[key as keyof typeof actual]!==value)throw new Error('MRP invariant failed: '+key);}
for(const input of [{physicalOnHand:-1,safetyStock:1},{physicalOnHand:1.5,safetyStock:1},{physicalOnHand:Number.MAX_SAFE_INTEGER,safetyStock:1}]){let rejected=false;try{calculateMaterialRequirement(input as never);}catch{rejected=true;}if(!rejected)throw new Error('Invalid quantity accepted');}
