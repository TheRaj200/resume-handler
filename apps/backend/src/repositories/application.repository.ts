import { Application, type ApplicationDocument } from "../models/Application";

export interface ApplicationEventData {
  status: string;
  note?: string;
  at?: Date;
}

export interface ApplicationData {
  _id?: string;
  userId?: string;
  company?: string;
  jobTitle?: string;
  jobUrl?: string;
  normalizedUrl?: string;
  jdSnapshot?: string;
  status?: string;
  appliedAt?: Date;
  source?: string;
  notes?: string;
  resumeVersionId?: string;
  version?: number;
  deletedAt?: Date | null;
  events?: ApplicationEventData[];
}

export interface ApplicationFilter {
  status?: string;
  search?: string;
}

export class ApplicationRepository {
  async findChangedSince(userId: string, since?: Date): Promise<ApplicationDocument[]> {
    const query: Record<string, unknown> = { userId };
    if (since) query.updatedAt = { $gt: since };
    return Application.find(query).sort({ updatedAt: 1 }).lean();
  }

  async findAll(userId: string, filter?: ApplicationFilter): Promise<ApplicationDocument[]> {
    const query: Record<string, unknown> = {
      userId,
      deletedAt: null,
    };

    if (filter?.status) {
      query.status = filter.status;
    }

    if (filter?.search?.trim()) {
      const regex = new RegExp(filter.search.trim(), "i");
      query.$or = [{ company: regex }, { jobTitle: regex }, { notes: regex }];
    }

    return Application.find(query).sort({ updatedAt: -1 }).lean();
  }

  async findById(id: string, userId: string): Promise<ApplicationDocument | null> {
    return Application.findOne({ _id: id, userId, deletedAt: null }).lean();
  }

  async findByNormalizedUrl(userId: string, normalizedUrl: string): Promise<ApplicationDocument | null> {
    return Application.findOne({ userId, normalizedUrl, deletedAt: null }).lean();
  }

  async findByCompanyAndRole(userId: string, company: string, jobTitle: string): Promise<ApplicationDocument | null> {
    const companyRegex = new RegExp(`^${company.trim()}$`, "i");
    const roleRegex = new RegExp(`^${jobTitle.trim()}$`, "i");
    return Application.findOne({
      userId,
      company: companyRegex,
      jobTitle: roleRegex,
      deletedAt: null,
    }).lean();
  }

  async create(data: ApplicationData): Promise<ApplicationDocument> {
    const record = new Application(data);
    await record.save();
    return record.toObject();
  }

  async update(
    id: string,
    userId: string,
    data: ApplicationData,
  ): Promise<ApplicationDocument | null> {
    return Application.findOneAndUpdate(
      { _id: id, userId, deletedAt: null },
      { $set: data },
      { new: true },
    ).lean();
  }

  async softDelete(id: string, userId: string): Promise<ApplicationDocument | null> {
    return Application.findOneAndUpdate(
      { _id: id, userId, deletedAt: null },
      { $set: { deletedAt: new Date() } },
      { new: true },
    ).lean();
  }
}

export const applicationRepository = new ApplicationRepository();
