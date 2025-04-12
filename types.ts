export interface IndeedInput {
    position: string;
    country: string;
    location: string;
    maxItems: number;
    parseCompanyDetails: boolean;
    saveOnlyUniqueItems: boolean;
    followApplyRedirects: boolean;
}

export interface JobListing {
    title: string;
    company: string;
    location: string;
    salary?: string;
    description: string;
    jobUrl: string;
    companyUrl?: string;
    postedDate?: string;
    jobType?: string;
}

export interface CompanyDetails {
    name: string;
    website?: string;
    size?: string;
    founded?: string;
    industry?: string;
    headquarters?: string;
    description?: string;
} 