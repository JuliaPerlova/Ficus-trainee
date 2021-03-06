import { Injectable, Inject, CACHE_MANAGER } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';

import { Cache } from 'cache-manager';

import * as jwt from 'jsonwebtoken';

import { UserService } from '../../user-service/src/user.service';
import { TokenService } from '../../token-service/src/token.service';
import { MailService } from '../../shared/mail-service/mail.service';

import { CreateUserDto } from '../../user-service/src/dto/create-user.dto';
import { statusEnum } from '../../user-service/src/enums/status.enum';
import code from '../../shared/codeGenerator/generate.code';

import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
    constructor(
        @Inject(CACHE_MANAGER) private readonly cache: Cache,
        private readonly userService: UserService,
        private readonly tokenService: TokenService,
        private readonly mailService: MailService,
    ) {}

    async signIn({ email, password }: LoginDto) {
        const user = await this.userService.checkUser(email, password);
        if (!user || user.errors) {
            throw new RpcException('Wrong email or password');
        }

        if (user.status !== statusEnum.active) {
            throw new RpcException('Confirm your email');
        }

        const payload = { _id: user._id, username: user.login };
        const accessToken = jwt.sign(
            { user: payload },
            `${process.env.ACESS_TOKEN_SECRET}`,
            { expiresIn: '10m' },
        );
        const refreshToken = jwt.sign(
            { user: payload },
            `${process.env.REFRESH_TOKEN_SECRET}`,
            { expiresIn: '7d' },
        );

        await this.tokenService.create({ token: refreshToken, uId: user._id });
        return { accessToken, refreshToken, id: user._id };
    }

    async signUp(createUserDto: CreateUserDto) {
        const { email, login } = createUserDto;
        const findEmail = await this.userService.findUserByEmail(email);

        const findLogin = await this.userService.findUserByUsername(login);

        if (findEmail) {
            throw new RpcException(
                'This email is already registered in system',
            );
        }

        if (findLogin.length > 0) {
            throw new RpcException('This username is taken. Try another');
        }

        const user: any = await this.userService.createUser(createUserDto);
        await this.getEmailVerification(user.email);
        return user;
    }

    async getEmailVerification(email: string) {
        const user: any = await this.userService.findUserByEmail(email);

        if (!user) {
            throw new RpcException('User with this email was not found');
        }
        const verificationCode = code();
        await this.cache.set(`${user._id}`, verificationCode, { ttl: 360 });
        await this.mailService.confirmEmail(email, verificationCode);
        console.log(email);
        return user;
    }

    async checkCode(userId: string, code: string) {
        let res = await this.cache.get(userId);
        await this.cache.del(userId);
        return code === `${res}` ? true : false;
    }

    async confirmEmail(userId: string, code: string) {
        const checked = await this.checkCode(userId, code);
        if (checked) {
            return await this.userService.updateUser(userId, {
                status: statusEnum.active,
            });
        }
        return checked;
    }

    async generateRefreshToken(refreshToken: string) {
        const checkToken = await this.tokenService.find(refreshToken);
        if (!checkToken) {
            throw new RpcException('Token was expired');
        }

        const payload: any = jwt.verify(
            refreshToken,
            `${process.env.REFRESH_TOKEN_SECRET}`,
        );

        const accessToken = jwt.sign(
            { user: payload.user },
            `${process.env.ACESS_TOKEN_SECRET}`,
            { expiresIn: '10m' },
        );

        return { accessToken };
    }

    async forgotPass(email: string) {
        const user = await this.userService.findUserByEmail(email);

        if (!user) {
            throw new RpcException('User with this email was not found');
        }

        const secretCode = code();
        this.cache.set(`${user._id}`, 360, secretCode);

        await this.mailService.forgotPassEmail(email, secretCode);
        return user;
    }

    async changePass(userId: string, newPass: string) {
        return await this.userService.updateUser(userId, { password: newPass });
    }

    async logout(token: string) {
        return await this.tokenService.delete(token);
    }

    async deleteProfile(userId: string, token: string) {
        await this.tokenService.delete(token);
        return await this.userService.deleteUser(userId);
    }
}
